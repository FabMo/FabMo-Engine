#!/bin/bash
# FabMo Dependency Update - Quick Test Script
# Run this script after npm install to verify basic functionality

set -e  # Exit on error

echo "=========================================="
echo "FabMo Dependency Update Test Suite"
echo "=========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to print test results
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        ((FAILED++))
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠ WARNING${NC}: $1"
    ((WARNINGS++))
}

echo "1. Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
    print_result 0 "Node.js version $(node --version) is >= 18.x"
else
    print_result 1 "Node.js version $(node --version) is < 18.x (required: 18.20.0+)"
fi

echo ""
echo "2. Checking npm packages installed..."
if [ -d "node_modules" ]; then
    print_result 0 "node_modules directory exists"
else
    print_result 1 "node_modules directory missing - run 'npm install'"
    exit 1
fi

echo ""
echo "3. Checking critical dependencies..."

# Check SerialPort
SP_VERSION=$(npm list serialport --depth=0 2>/dev/null | grep serialport@ | cut -d'@' -f2 | cut -d' ' -f1)
if [[ "$SP_VERSION" =~ ^12\. ]]; then
    print_result 0 "serialport version $SP_VERSION (v12.x required)"
else
    print_result 1 "serialport version $SP_VERSION (expected v12.x)"
fi

# Check Q is NOT installed (we removed it)
if npm list q --depth=0 2>&1 | grep -q "UNMET"; then
    print_result 0 "Q library successfully removed"
else
    Q_VERSION=$(npm list q --depth=0 2>/dev/null | grep " q@" | cut -d'@' -f2 || echo "not found")
    if [ "$Q_VERSION" != "not found" ]; then
        print_warning "Q library still present (version $Q_VERSION) - should be removed"
    fi
fi

# Check multer
MULTER_VERSION=$(npm list multer --depth=0 2>/dev/null | grep multer@ | cut -d'@' -f2 | cut -d' ' -f1)
if [[ "$MULTER_VERSION" =~ ^2\. ]]; then
    print_result 0 "multer version $MULTER_VERSION (v2.x required)"
else
    print_result 1 "multer version $MULTER_VERSION (expected v2.x)"
fi

# Check glob
GLOB_VERSION=$(npm list glob --depth=0 2>/dev/null | grep " glob@" | cut -d'@' -f2 | cut -d' ' -f1)
if [[ "$GLOB_VERSION" =~ ^9\. ]]; then
    print_result 0 "glob version $GLOB_VERSION (v9.x required)"
else
    print_result 1 "glob version $GLOB_VERSION (expected v9.x)"
fi

echo ""
echo "4. Checking for deprecated warnings..."
# This will show warnings but won't fail the script
npm list --depth=0 2>&1 | grep -i "deprecated" > /tmp/fabmo_deprecated.txt || true
if [ -s /tmp/fabmo_deprecated.txt ]; then
    print_warning "Some deprecated packages still present (see npm output)"
    cat /tmp/fabmo_deprecated.txt
else
    print_result 0 "No deprecated package warnings"
fi

echo ""
echo "5. Testing webpack build..."
if npm run webpack > /tmp/fabmo_webpack.log 2>&1; then
    print_result 0 "Webpack build successful"
    # Check that key files were built
    if [ -f "dashboard/build/dashboard.js" ]; then
        print_result 0 "dashboard.js built"
    else
        print_result 1 "dashboard.js missing from build output"
    fi
else
    print_result 1 "Webpack build failed (see /tmp/fabmo_webpack.log)"
    cat /tmp/fabmo_webpack.log
fi

echo ""
echo "6. Checking ESLint configuration..."
if [ -f "eslint.config.js" ]; then
    print_result 0 "ESLint v9 flat config exists (eslint.config.js)"
    if [ -f ".eslintrc.js" ]; then
        print_warning "Old .eslintrc.js still present - can be removed after verifying new config"
    fi
else
    print_result 1 "eslint.config.js missing"
fi

echo ""
echo "7. Verifying code changes..."

# Check g2.js for new SerialPort import
if grep -q "const { SerialPort } = require(\"serialport\");" g2.js; then
    print_result 0 "g2.js updated to SerialPort v12 import syntax"
else
    print_result 1 "g2.js missing SerialPort v12 import update"
fi

# Check g2.js doesn't import Q anymore
if grep -q "require(\"q\")" g2.js; then
    print_result 1 "g2.js still imports Q library"
else
    print_result 0 "g2.js Q library import removed"
fi

# Check for native Promise usage in g2.js
if grep -q "new Promise(" g2.js; then
    print_result 0 "g2.js using native Promises"
else
    print_result 1 "g2.js missing native Promise usage"
fi

# Check manual/driver.js
if ! grep -q "require(\"q\")" runtime/manual/driver.js; then
    print_result 0 "runtime/manual/driver.js Q library removed"
else
    print_result 1 "runtime/manual/driver.js still imports Q library"
fi

# Check util.js
if ! grep -q "require(\"q\")" util.js; then
    print_result 0 "util.js Q library removed"
else
    print_result 1 "util.js still imports Q library"
fi

echo ""
echo "8. Running tests (if available)..."
if [ -d "test" ]; then
    if npm test > /tmp/fabmo_test.log 2>&1; then
        print_result 0 "npm test passed"
    else
        print_result 1 "npm test failed (see /tmp/fabmo_test.log)"
        tail -20 /tmp/fabmo_test.log
    fi
else
    print_warning "No test directory found - skipping unit tests"
fi

echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All critical tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Review DEPENDENCY_UPDATE_MIGRATION.md for Phase 3 testing"
    echo "2. Test on a Raspberry Pi with G2 hardware connected"
    echo "3. Follow the critical SerialPort testing checklist"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Review errors above.${NC}"
    echo ""
    echo "Common fixes:"
    echo "1. Run 'npm install' to ensure all packages are installed"
    echo "2. Check Node.js version is 18.20.0 or higher"
    echo "3. Review code changes in g2.js, util.js, runtime/manual/driver.js"
    exit 1
fi
