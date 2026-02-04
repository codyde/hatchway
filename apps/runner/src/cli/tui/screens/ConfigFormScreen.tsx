import { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { Banner, RadioGroup, type RadioOption } from '../components/index.js';
import { colors, symbols } from '../theme.js';

export interface InitFormConfig {
  branch: string;
  workspace: string;
  useNeon: boolean;
  databaseUrl?: string;
}

export interface ConfigFormScreenProps {
  initialConfig?: Partial<InitFormConfig>;
  onSubmit: (config: InitFormConfig) => void;
  onEscape: () => void;
  error?: string; // Error message to display (e.g., "Branch not found")
}

type FocusedField = 'branch' | 'workspace' | 'database' | 'databaseUrl';

const databaseOptions: RadioOption[] = [
  { id: 'neon', label: 'Use Neon (automatic setup)' },
  { id: 'custom', label: 'Custom PostgreSQL' },
];

// Fixed label width for alignment
const LABEL_WIDTH = 14;

/**
 * Interactive configuration form for init/reinit
 */
export function ConfigFormScreen({
  initialConfig,
  onSubmit,
  onEscape,
  error,
}: ConfigFormScreenProps) {
  const { stdout } = useStdout();
  
  // Form state
  const [branch, setBranch] = useState(initialConfig?.branch || 'main');
  
  // Clear error when user starts typing in branch field
  const handleBranchChange = (value: string) => {
    setBranch(value);
  };
  const [workspace, setWorkspace] = useState(
    initialConfig?.workspace || '~/hatchway-workspace'
  );
  const [databaseType, setDatabaseType] = useState<'neon' | 'custom'>(
    initialConfig?.useNeon === false ? 'custom' : 'neon'
  );
  const [databaseUrl, setDatabaseUrl] = useState(initialConfig?.databaseUrl || '');
  
  const [focusedField, setFocusedField] = useState<FocusedField>('branch');
  
  // Calculate vertical centering
  const terminalHeight = stdout?.rows || 24;
  const contentHeight = 22;
  const topPadding = Math.max(0, Math.floor((terminalHeight - contentHeight) / 3));

  // Field order for navigation
  const fieldOrder: FocusedField[] = databaseType === 'custom' 
    ? ['branch', 'workspace', 'database', 'databaseUrl']
    : ['branch', 'workspace', 'database'];

  const currentFieldIndex = fieldOrder.indexOf(focusedField);
  const isLastField = currentFieldIndex === fieldOrder.length - 1;

  useInput((input, key) => {
    if (key.escape) {
      onEscape();
      return;
    }

    // Shift+Enter to submit immediately from any field
    if (key.return && key.shift) {
      handleSubmit();
      return;
    }

    // Regular Enter moves to next field, or submits if on last field
    if (key.return && !key.shift) {
      if (isLastField) {
        handleSubmit();
      } else {
        setFocusedField(fieldOrder[currentFieldIndex + 1]);
      }
      return;
    }

    // Tab or Down arrow moves to next field
    if (key.tab || key.downArrow) {
      if (focusedField !== 'database') {
        const nextIndex = (currentFieldIndex + 1) % fieldOrder.length;
        setFocusedField(fieldOrder[nextIndex]);
      }
      return;
    }

    // Up arrow moves to previous field
    if (key.upArrow) {
      if (focusedField !== 'database') {
        const prevIndex = currentFieldIndex > 0 ? currentFieldIndex - 1 : fieldOrder.length - 1;
        setFocusedField(fieldOrder[prevIndex]);
      }
      return;
    }
  });

  const handleSubmit = () => {
    const config: InitFormConfig = {
      branch: branch.trim() || 'main',
      workspace: workspace.trim() || '~/hatchway-workspace',
      useNeon: databaseType === 'neon',
      databaseUrl: databaseType === 'custom' ? databaseUrl.trim() : undefined,
    };
    onSubmit(config);
  };

  const handleDatabaseTypeChange = (id: string) => {
    setDatabaseType(id as 'neon' | 'custom');
    // If switching to custom, focus the URL field
    if (id === 'custom') {
      setFocusedField('databaseUrl');
    }
  };

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={topPadding}>
      {/* Banner */}
      <Banner />
      
      {/* Spacer */}
      <Box marginTop={1} />
      
      {/* Title */}
      <Text color={colors.cyan} bold>Configure Hatchway</Text>
      
      {/* Spacer */}
      <Box marginTop={2} />
      
      {/* Form fields */}
      <Box flexDirection="column" gap={1}>
        {/* Branch - editable branch name */}
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center">
            <Box width={LABEL_WIDTH} justifyContent="flex-end" marginRight={1}>
              <Text color={error ? colors.error : (focusedField === 'branch' ? colors.cyan : colors.gray)}>
                Branch
              </Text>
            </Box>
            <Box
              borderStyle="round"
              borderColor={error ? colors.error : (focusedField === 'branch' ? colors.cyan : colors.darkGray)}
              paddingX={1}
            >
              {focusedField === 'branch' ? (
                <TextInput
                  value={branch}
                  onChange={handleBranchChange}
                  placeholder="main"
                />
              ) : (
                <Text color={branch ? colors.white : colors.dimGray}>
                  {branch || 'main'}
                </Text>
              )}
            </Box>
          </Box>
          {/* Error message below branch field */}
          {error && (
            <Box marginLeft={LABEL_WIDTH + 2}>
              <Text color={colors.error}>
                {symbols.cross} {error}
              </Text>
            </Box>
          )}
        </Box>
        
        {/* Workspace */}
        <Box flexDirection="row" alignItems="center">
          <Box width={LABEL_WIDTH} justifyContent="flex-end" marginRight={1}>
            <Text color={focusedField === 'workspace' ? colors.cyan : colors.gray}>
              Workspace
            </Text>
          </Box>
          <Box
            borderStyle="round"
            borderColor={focusedField === 'workspace' ? colors.cyan : colors.darkGray}
            paddingX={1}
            width={40}
          >
            {focusedField === 'workspace' ? (
              <TextInput
                value={workspace}
                onChange={setWorkspace}
                placeholder="~/hatchway-workspace"
              />
            ) : (
              <Text color={workspace ? colors.white : colors.dimGray}>
                {workspace || '~/hatchway-workspace'}
              </Text>
            )}
          </Box>
        </Box>
        
        {/* Database type */}
        <Box marginTop={1} flexDirection="row" alignItems="center">
          <Box width={LABEL_WIDTH} justifyContent="flex-end" marginRight={1}>
            <Text color={focusedField === 'database' ? colors.cyan : colors.gray}>
              Database
            </Text>
          </Box>
          <RadioGroup
            options={databaseOptions}
            selected={databaseType}
            onChange={handleDatabaseTypeChange}
            focused={focusedField === 'database'}
          />
        </Box>
        
        {/* Custom database URL (only shown when custom is selected) */}
        {databaseType === 'custom' && (
          <Box marginTop={1} flexDirection="row" alignItems="center">
            <Box width={LABEL_WIDTH} justifyContent="flex-end" marginRight={1}>
              <Text color={focusedField === 'databaseUrl' ? colors.cyan : colors.gray}>
                URL
              </Text>
            </Box>
            <Box
              borderStyle="round"
              borderColor={focusedField === 'databaseUrl' ? colors.cyan : colors.darkGray}
              paddingX={1}
              width={50}
            >
              {focusedField === 'databaseUrl' ? (
                <TextInput
                  value={databaseUrl}
                  onChange={setDatabaseUrl}
                  placeholder="postgres://user:pass@host:5432/db"
                />
              ) : (
                <Text color={databaseUrl ? colors.white : colors.dimGray}>
                  {databaseUrl || 'postgres://user:pass@host:5432/db'}
                </Text>
              )}
            </Box>
          </Box>
        )}
      </Box>
      
      {/* Spacer */}
      <Box marginTop={3} />
      
      {/* Help text */}
      <Box flexDirection="column" alignItems="center">
        <Text color={colors.dimGray}>
          Enter: {isLastField ? 'Start' : 'Next field'} | Shift+Enter: Start now | Esc: Back
        </Text>
        {databaseType === 'custom' && !databaseUrl.trim() && (
          <Box marginTop={1}>
            <Text color={colors.warning}>
              {symbols.hollowDot} Database URL required for custom PostgreSQL
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
