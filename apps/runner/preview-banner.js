#!/usr/bin/env node

/**
 * Quick preview script to see the Hatchway banners
 * Run with: node preview-banner.js
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  purple: '\x1b[35m',
  brightPurple: '\x1b[95m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

console.log('\n');
console.log(colors.white + '='.repeat(70) + colors.reset);
console.log(colors.white + 'CLI Startup Banner:' + colors.reset);
console.log(colors.white + '='.repeat(70) + colors.reset);

const startupBanner = `
${colors.cyan}██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗${colors.brightPurple}██╗    ██╗ █████╗ ██╗   ██╗${colors.reset}
${colors.cyan}██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║${colors.brightPurple}██║    ██║██╔══██╗╚██╗ ██╔╝${colors.reset}
${colors.cyan}███████║███████║   ██║   ██║     ███████║${colors.brightPurple}██║ █╗ ██║███████║ ╚████╔╝ ${colors.reset}
${colors.cyan}██╔══██║██╔══██║   ██║   ██║     ██╔══██║${colors.brightPurple}██║███╗██║██╔══██║  ╚██╔╝  ${colors.reset}
${colors.cyan}██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║${colors.brightPurple}╚███╔███╔╝██║  ██║   ██║   ${colors.reset}
${colors.cyan}╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝${colors.brightPurple} ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ${colors.reset}
`;

console.log(startupBanner);

console.log('\n');
console.log(colors.white + '='.repeat(80) + colors.reset);
console.log(colors.white + 'Setup Complete Output (Full Preview):' + colors.reset);
console.log(colors.white + '='.repeat(80) + colors.reset);
console.log('');

const setupCompleteBanner = `
${colors.cyan}██╗  ██╗ █████╗ ████████╗ ██████╗██╗  ██╗${colors.brightPurple}██╗    ██╗ █████╗ ██╗   ██╗${colors.reset}
${colors.cyan}██║  ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║${colors.brightPurple}██║    ██║██╔══██╗╚██╗ ██╔╝${colors.reset}
${colors.cyan}███████║███████║   ██║   ██║     ███████║${colors.brightPurple}██║ █╗ ██║███████║ ╚████╔╝ ${colors.reset}
${colors.cyan}██╔══██║██╔══██║   ██║   ██║     ██╔══██║${colors.brightPurple}██║███╗██║██╔══██║  ╚██╔╝  ${colors.reset}
${colors.cyan}██║  ██║██║  ██║   ██║   ╚██████╗██║  ██║${colors.brightPurple}╚███╔███╔╝██║  ██║   ██║   ${colors.reset}
${colors.cyan}╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝${colors.brightPurple} ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ${colors.reset}
${colors.white}                        Setup is complete! 🎉${colors.reset}
`;

console.log(setupCompleteBanner);

// Show sample info output
console.log(colors.cyan + 'ℹ' + colors.reset + ' Config file: ' + colors.cyan + '~/.config/hatchway/config.json' + colors.reset);
console.log(colors.cyan + 'ℹ' + colors.reset + ' Workspace: ' + colors.cyan + '~/hatchway-workspace' + colors.reset);
console.log(colors.cyan + 'ℹ' + colors.reset + ' Repository: ' + colors.cyan + '/Users/username/hatchway' + colors.reset);
console.log('');

// Show next steps
console.log(colors.cyan + 'ℹ' + colors.reset + ' Next steps:');
console.log('  1. Run ' + colors.cyan + 'hatchway run' + colors.reset + ' to start the full stack');
console.log('  2. Or ' + colors.cyan + 'hatchway --runner' + colors.reset + ' for runner only');
console.log('');
console.log('');

// Show help reference
console.log(colors.cyan + 'ℹ' + colors.reset + ' Run ' + colors.cyan + 'hatchway --help' + colors.reset + ' to see all available commands and options');
console.log('\n');
