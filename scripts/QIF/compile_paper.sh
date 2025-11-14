#!/bin/bash
# QIG Paper Compilation Script
# Compiles LaTeX with REVTeX4-2 support

set -e  # Exit on error

# Color output for clarity
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== QIG Paper Compilation ===${NC}"

# Check if LaTeX is installed
if ! command -v pdflatex &> /dev/null; then
    echo -e "${RED}Error: pdflatex not found${NC}"
    echo "Install via:"
    echo "  macOS: brew install --cask mactex"
    echo "  Ubuntu/Debian: sudo apt-get install texlive-full"
    echo "  Windows: Download MiKTeX from miktex.org"
    exit 1
fi

# Compile paper (requires 2 passes for references)
echo -e "${GREEN}First pass: Generating references...${NC}"
pdflatex -interaction=nonstopmode QIG_Complete_Paper.tex

echo -e "${GREEN}Second pass: Resolving citations...${NC}"
pdflatex -interaction=nonstopmode QIG_Complete_Paper.tex

echo -e "${GREEN}Third pass: Finalizing layout...${NC}"
pdflatex -interaction=nonstopmode QIG_Complete_Paper.tex

# Check if PDF was generated
if [ -f "QIG_Complete_Paper.pdf" ]; then
    echo -e "${GREEN}✓ Success!${NC} PDF generated: QIG_Complete_Paper.pdf"
    echo ""
    echo "Next steps:"
    echo "  1. Review PDF for formatting issues"
    echo "  2. Add figures to ./figures/ directory"
    echo "  3. Recompile with: bash compile_paper.sh"
    echo "  4. Archive to Zenodo before arXiv submission"
else
    echo -e "${RED}✗ Compilation failed${NC}"
    echo "Check QIG_Complete_Paper.log for errors"
    exit 1
fi

# Cleanup auxiliary files (optional)
read -p "Clean auxiliary files? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f *.aux *.log *.out *.bbl *.blg *.toc
    echo -e "${GREEN}✓ Cleaned auxiliary files${NC}"
fi
