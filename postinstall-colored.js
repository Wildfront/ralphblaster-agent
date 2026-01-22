#!/usr/bin/env node

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  red: '\x1b[31m',
};

const ralph = `
${colors.gray}           /\\
          /  \\
         /    \\
        |      |
        |  ${colors.bright}${colors.yellow}${colors.reset}${colors.gray}${colors.bright}${colors.yellow}.${colors.reset}${colors.gray}  |
        | ${colors.yellow}(${colors.bright}${colors.yellow}o${colors.reset}${colors.yellow})${colors.reset}${colors.gray} |        ${colors.bright}${colors.yellow}Ralph Agent${colors.reset}
        | ${colors.yellow}(${colors.bright}${colors.yellow}o${colors.reset}${colors.yellow})${colors.reset}${colors.gray} |        ${colors.dim}v1.3.3${colors.reset}
        |  ${colors.yellow}~${colors.reset}${colors.gray}  |
        | ${colors.red}\\___/${colors.reset}${colors.gray} |
        |      |
        |      |
        |      |
       /|      |\\
      / |      | \\
     /  |      |  \\
    /__/|      |\\__\\
       ${colors.orange}/|${colors.reset}${colors.gray}    ${colors.orange}|\\${colors.reset}
      ${colors.orange}/ |${colors.reset}${colors.gray}    ${colors.orange}| \\${colors.reset}
     ${colors.bright}${colors.yellow}/  ${colors.reset}${colors.orange}|${colors.reset}${colors.gray}    ${colors.orange}|  ${colors.bright}${colors.yellow}\\${colors.reset}
    ${colors.bright}${colors.yellow}'   ${colors.reset}${colors.orange}|${colors.reset}${colors.gray}    ${colors.orange}|   ${colors.bright}${colors.yellow}'${colors.reset}
        ${colors.orange}|${colors.reset}${colors.gray}    ${colors.orange}|${colors.reset}
`;

const message = `
${ralph}

${colors.bright}${colors.green}Installed successfully!${colors.reset}

${colors.green}Getting Started:${colors.reset}

  ${colors.dim}1.${colors.reset} Make sure Claude CLI is installed:
     ${colors.yellow}claude --version${colors.reset}

  ${colors.dim}2.${colors.reset} Get your API token from Ralph (requires 'ralph_agent' permission)

  ${colors.dim}3.${colors.reset} Start the agent:
     ${colors.yellow}ralphblaster --token=your_api_token_here${colors.reset}

${colors.green}Documentation:${colors.reset}
  ${colors.cyan}https://github.com/Wildfront/ralphblaster-agent#readme${colors.reset}

`;

console.log(message);
