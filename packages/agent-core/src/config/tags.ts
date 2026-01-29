/**
 * Tag Configuration
 *
 * This file defines all available tags for configuring builds.
 * Tags are organized into categories and can be nested for complex configurations.
 */

export interface TagOption {
  value: string;
  label: string;
  description?: string;
  // For theme/brand tags - bundle of values that get expanded
  values?: Record<string, string>;
  // For brand tags - logo path
  logo?: string;
  // For model tags - provider and model mapping
  provider?: string;
  model?: string;
  // For framework tags - template repository information
  repository?: string;
  branch?: string;
}

export interface TagDefinition {
  key: string;
  label: string;
  description: string;
  category: 'model' | 'framework' | 'design' | 'runner';
  inputType: 'select' | 'color' | 'nested' | 'multi-select';
  options?: TagOption[];
  // For nested tags like "design" -> "primaryColor"
  children?: TagDefinition[];
  // How this tag's value gets injected into AI prompt
  promptTemplate?: string;
  // Allow multiple instances of this tag
  allowMultiple?: boolean;
  // Maximum number of selections (for multi-select)
  maxSelections?: number;
}

export const TAG_DEFINITIONS: TagDefinition[] = [
  // Model Selection (explicit provider + model mapping)
  {
    key: 'model',
    label: 'Model',
    description: 'AI agent and model to use for generation',
    category: 'model',
    inputType: 'select',
    options: [
      {
        value: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        description: 'Anthropic Claude - Balanced performance and speed',
        logo: '/claude.png',
        provider: 'claude-code',
        model: 'claude-sonnet-4-5'
      },
      {
        value: 'claude-opus-4-5',
        label: 'Claude Opus 4.5',
        description: 'Anthropic Claude - Most capable for complex tasks',
        logo: '/claude.png',
        provider: 'claude-code',
        model: 'claude-opus-4-5'
      },
      {
        value: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        description: 'Anthropic Claude - Fastest, good for iterations',
        logo: '/claude.png',
        provider: 'claude-code',
        model: 'claude-haiku-4-5'
      },
      {
        value: 'gpt-5.2-codex',
        label: 'GPT-5.2 Codex',
        description: 'OpenAI Codex - Advanced code generation',
        logo: '/openai.png',
        provider: 'openai-codex',
        model: 'openai/gpt-5.2-codex'
      },
      {
        value: 'factory-droid',
        label: 'Factory Droid',
        description: 'Factory Droid SDK - Uses droid CLI for builds',
        logo: '/factory.png',
        provider: 'factory-droid',
        model: undefined
      }
    ]
  },

  // Framework Selection
  {
    key: 'framework',
    label: 'Framework',
    description: 'Frontend framework to use',
    category: 'framework',
    inputType: 'select',
    options: [
      {
        value: 'next',
        label: 'Next.js',
        description: 'Full-stack React with SSR, App Router, and file-based routing',
        logo: '/logos/nextjs.svg',
        repository: 'github:codyde/template-nextjs',
        branch: 'main'
      },
      {
        value: 'tanstack',
        label: 'TanStack Start',
        description: 'Minimal TanStack Start foundation with React 19, Router, Query, and Tailwind',
        logo: '/logos/tanstack.png',
        repository: 'github:codyde/template-tanstackstart',
        branch: 'main'
      },
      {
        value: 'vite',
        label: 'React + Vite',
        description: 'Fast React SPA with Vite - perfect for client-side apps',
        logo: '/logos/react.svg',
        repository: 'github:codyde/template-reactvite',
        branch: 'main'
      },
      {
        value: 'astro',
        label: 'Astro',
        description: 'Content-focused static sites with islands architecture',
        logo: '/astro.png',
        repository: 'github:codyde/template-astro',
        branch: 'main'
      }
    ],
    promptTemplate: 'CRITICAL: You MUST use the {label} template. Clone it using: npx degit {repository}#{branch} {{projectName}}'
  },

  // Runner Selection (options populated dynamically)
  {
    key: 'runner',
    label: 'Runner',
    description: 'Build runner to execute the build',
    category: 'runner',
    inputType: 'select',
    options: [] // Populated dynamically from connected runners
  },

  // Design Configuration (nested)
  {
    key: 'design',
    label: 'Design',
    description: 'Visual design preferences',
    category: 'design',
    inputType: 'nested',
    children: [
      // Brand Themes
      {
        key: 'brand',
        label: 'Brand',
        description: 'Pre-configured brand color themes',
        category: 'design',
        inputType: 'select',
        maxSelections: 1,
        options: [
          {
            value: 'sentry',
            label: 'Sentry',
            description: 'Error monitoring and performance - vibrant purple and pink',
            logo: '/logos/sentry.svg',
            values: {
              primaryColor: '#9D58BF',
              secondaryColor: '#FF708C',
              accentColor: '#FF9838',
              neutralLight: '#F0ECF3',
              neutralDark: '#2B2233'
            }
          },
          {
            value: 'stripe',
            label: 'Stripe',
            description: 'Modern payments aesthetic',
            logo: '/logos/stripe.svg',
            values: {
              primaryColor: '#635bff',
              secondaryColor: '#0a2540',
              accentColor: '#00d4ff',
              neutralLight: '#f6f9fc',
              neutralDark: '#0a2540'
            }
          },
          {
            value: 'vercel',
            label: 'Vercel',
            description: 'Clean developer tools',
            logo: '/logos/vercel.svg',
            values: {
              primaryColor: '#000000',
              secondaryColor: '#ffffff',
              accentColor: '#0070f3',
              neutralLight: '#fafafa',
              neutralDark: '#000000'
            }
          },
          {
            value: 'linear',
            label: 'Linear',
            description: 'Sleek project management',
            logo: '/logos/linear.svg',
            values: {
              primaryColor: '#5e6ad2',
              secondaryColor: '#26b5ce',
              accentColor: '#f2994a',
              neutralLight: '#f7f8f8',
              neutralDark: '#1a1a1a'
            }
          },
          {
            value: 'notion',
            label: 'Notion',
            description: 'Warm productivity',
            logo: '/logos/notion.svg',
            values: {
              primaryColor: '#2383e2',
              secondaryColor: '#e69138',
              accentColor: '#d44c47',
              neutralLight: '#f7f6f3',
              neutralDark: '#37352f'
            }
          },
          {
            value: 'github',
            label: 'GitHub',
            description: 'Developer-first',
            logo: '/logos/github.svg',
            values: {
              primaryColor: '#238636',
              secondaryColor: '#1f6feb',
              accentColor: '#f85149',
              neutralLight: '#f6f8fa',
              neutralDark: '#24292f'
            }
          },
          {
            value: 'airbnb',
            label: 'Airbnb',
            description: 'Friendly travel',
            logo: '/logos/airbnb.svg',
            values: {
              primaryColor: '#ff385c',
              secondaryColor: '#00a699',
              accentColor: '#fc642d',
              neutralLight: '#f7f7f7',
              neutralDark: '#222222'
            }
          },
          {
            value: 'spotify',
            label: 'Spotify',
            description: 'Bold music streaming',
            logo: '/logos/spotify.svg',
            values: {
              primaryColor: '#1db954',
              secondaryColor: '#191414',
              accentColor: '#1ed760',
              neutralLight: '#f6f6f6',
              neutralDark: '#000000'
            }
          }
        ],
        promptTemplate: 'Use the {value} brand aesthetic with the following color palette: Primary: {primaryColor}, Secondary: {secondaryColor}, Accent: {accentColor}, Neutral Light: {neutralLight}, Neutral Dark: {neutralDark}. Match the design style and feel of {value}.'
      }
    ]
  }
];

/**
 * Find a tag definition by key
 */
export function findTagDefinition(key: string): TagDefinition | undefined {
  for (const def of TAG_DEFINITIONS) {
    if (def.key === key) return def;
    if (def.children) {
      const child = def.children.find(c => c.key === key);
      if (child) return child;
    }
  }
  return undefined;
}

/**
 * Get all available tag keys (flattened)
 */
export function getAllTagKeys(): string[] {
  const keys: string[] = [];
  for (const def of TAG_DEFINITIONS) {
    keys.push(def.key);
    if (def.children) {
      keys.push(...def.children.map(c => c.key));
    }
  }
  return keys;
}

/**
 * Get tag definitions by category
 */
export function getTagsByCategory(category: TagDefinition['category']): TagDefinition[] {
  return TAG_DEFINITIONS.filter(def => def.category === category);
}
