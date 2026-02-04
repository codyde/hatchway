'use client';

import React from 'react';
import { Plus, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TagBadge } from './TagBadge';
import { TagDropdown } from './TagDropdown';
import { AppliedTag } from '@hatchway/agent-core/types/tags';
import { TagOption, findTagDefinition } from '@hatchway/agent-core/config/tags';
import { validateTagSet } from '@hatchway/agent-core/lib/tags/resolver';
import { ConnectRunnerWizard } from '@/components/runner';

// Priority order for tags: runner first, model second, then others
const TAG_PRIORITY: Record<string, number> = {
  runner: 0,
  model: 1,
};

function sortTagsByPriority(tags: AppliedTag[]): AppliedTag[] {
  return [...tags].sort((a, b) => {
    const priorityA = TAG_PRIORITY[a.key] ?? 999;
    const priorityB = TAG_PRIORITY[b.key] ?? 999;
    return priorityA - priorityB;
  });
}

interface TagInputProps {
  tags: AppliedTag[];
  onTagsChange: (tags: AppliedTag[]) => void;
  runnerOptions?: TagOption[];
  className?: string;
  /** Whether any runners are currently connected */
  hasConnectedRunners?: boolean;
}

export function TagInput({
  tags,
  onTagsChange,
  runnerOptions,
  className = '',
  hasConnectedRunners = true,
}: TagInputProps) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);
  const [showConnectWizard, setShowConnectWizard] = React.useState(false);

  const handleAddTag = (key: string, value: string, expandedValues?: Record<string, string>) => {
    const def = findTagDefinition(key);

    // For multi-select tags, check if this value already exists
    if (def?.allowMultiple) {
      const existingTag = tags.find(t => t.key === key && t.value === value);
      if (existingTag) {
        // Don't add duplicate
        return;
      }
      // Add to existing tags without removing others with same key
    } else {
      // For single-value tags, remove existing tag with same key
      const filteredTags = tags.filter(t => t.key !== key);
      const newTag: AppliedTag = {
        key,
        value,
        expandedValues,
        appliedAt: new Date()
      };
      onTagsChange(sortTagsByPriority([...filteredTags, newTag]));
      return;
    }

    // Create new tag for multi-select
    const newTag: AppliedTag = {
      key,
      value,
      expandedValues,
      appliedAt: new Date()
    };

    onTagsChange(sortTagsByPriority([...tags, newTag]));
  };

  const handleRemoveTag = (key: string, value?: string) => {
    if (value) {
      // Remove specific tag by key AND value (for multi-select)
      onTagsChange(sortTagsByPriority(tags.filter(t => !(t.key === key && t.value === value))));
    } else {
      // Remove by key only
      onTagsChange(sortTagsByPriority(tags.filter(t => t.key !== key)));
    }
  };

  const handleReplaceTag = (oldTag: AppliedTag, newKey: string, newValue: string, expandedValues?: Record<string, string>) => {
    // Remove the old tag and add the new one
    const filteredTags = tags.filter(t => !(t.key === oldTag.key && t.value === oldTag.value));
    const newTag: AppliedTag = {
      key: newKey,
      value: newValue,
      expandedValues,
      appliedAt: new Date()
    };
    onTagsChange(sortTagsByPriority([...filteredTags, newTag]));
  };

  // Validate tags whenever they change
  React.useEffect(() => {
    if (tags.length === 0) {
      setValidationErrors([]);
      return;
    }

    const validation = validateTagSet(tags);
    setValidationErrors(validation.errors);
  }, [tags]);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Applied tags */}
        {tags.map((tag, index) => (
          <TagBadge
            key={`${tag.key}-${tag.value}-${index}`}
            tag={tag}
            onRemove={() => handleRemoveTag(tag.key, tag.value)}
            onReplace={(key, value, expandedValues) => handleReplaceTag(tag, key, value, expandedValues)}
            runnerOptions={runnerOptions}
          />
        ))}

        {/* Show Connect Runner button if no runners connected */}
        {!hasConnectedRunners ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConnectWizard(true)}
            className="h-7 px-3 font-mono text-xs border border-border bg-muted/50 hover:bg-muted hover:border-border text-foreground"
          >
            <Plug className="w-3 h-3 mr-1.5" />
            Connect a Runner
          </Button>
        ) : (
          /* Add tag button */
          <TagDropdown
            open={dropdownOpen}
            onOpenChange={setDropdownOpen}
            onSelectTag={handleAddTag}
            runnerOptions={runnerOptions}
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 font-mono text-xs border-2 border-border bg-muted/50 hover:bg-muted hover:border-border text-foreground"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Tag
            </Button>
          </TagDropdown>
        )}
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="mt-2 text-xs text-red-400 space-y-1">
          {validationErrors.map((error, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-red-500">⚠</span>
              <span>{error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Connect Runner Wizard Modal */}
      <ConnectRunnerWizard
        open={showConnectWizard}
        onOpenChange={setShowConnectWizard}
      />
    </div>
  );
}
