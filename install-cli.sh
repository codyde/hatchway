#!/bin/bash
# Hatchway CLI Installation Script
#
# This is a thin wrapper that ensures Node.js is available,
# then runs the Node.js-based installer for a beautiful experience.
#
# Usage: curl -fsSL https://hatchway.sh/install | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo ""
    echo -e "${RED}✖ Node.js not found${NC}"
    echo ""
    echo "  Hatchway requires Node.js 20 or later."
    echo ""
    echo "  Install Node.js from:"
    echo -e "    ${CYAN}https://nodejs.org${NC}"
    echo ""
    echo "  Or using nvm:"
    echo -e "    ${CYAN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash${NC}"
    echo -e "    ${CYAN}nvm install 20${NC}"
    echo ""
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo ""
    echo -e "${YELLOW}! Node.js 20+ required${NC} (you have $(node --version))"
    echo ""
    echo "  Upgrade Node.js from:"
    echo -e "    ${CYAN}https://nodejs.org${NC}"
    echo ""
    echo "  Or using nvm:"
    echo -e "    ${CYAN}nvm install 20 && nvm use 20${NC}"
    echo ""
    exit 1
fi

# Run the Node.js installer by piping to node stdin
curl -fsSL https://raw.githubusercontent.com/codyde/hatchway/main/install.mjs | node --input-type=module -
