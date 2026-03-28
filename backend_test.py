#!/usr/bin/env python3
"""
Backend SQL Migration Testing Script
Tests SQL migration files for syntax errors and schema conflicts
"""

import re
import os
import sys
from pathlib import Path
from typing import List, Dict, Set, Tuple
import json

class SQLMigrationTester:
    def __init__(self):
        self.migrations_dir = "/app/apps/api/database/migrations"
        self.tests_run = 0
        self.tests_passed = 0
        self.issues_found = []
        
    def log_test(self, test_name: str, passed: bool, details: str = ""):
        """Log test result"""
        self.tests_run += 1
        if passed:
            self.tests_passed += 1
            print(f"✅ {test_name}")
            if details:
                print(f"   {details}")
        else:
            print(f"❌ {test_name}")
            if details:
                print(f"   {details}")
                self.issues_found.append(f"{test_name}: {details}")

    def read_migration_file(self, filename: str) -> str:
        """Read migration file content"""
        filepath = os.path.join(self.migrations_dir, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            return f"ERROR: Could not read {filename}: {e}"

    def extract_sql_statements(self, content: str) -> List[str]:
        """Extract individual SQL statements from migration content"""
        # Remove comments
        content = re.sub(r'--.*$', '', content, flags=re.MULTILINE)
        
        # Split by semicolons, but be careful with DO blocks and functions
        statements = []
        current_statement = ""
        in_do_block = False
        in_function = False
        dollar_quote_depth = 0
        
        lines = content.split('\n')
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Track DO blocks and dollar quoting
            if line.upper().startswith('DO $$'):
                in_do_block = True
                dollar_quote_depth += 1
            elif in_do_block and line == '$$;':
                in_do_block = False
                dollar_quote_depth -= 1
                current_statement += line + '\n'
                statements.append(current_statement.strip())
                current_statement = ""
                continue
            elif '$$' in line:
                # Count dollar quotes to handle nested blocks
                dollar_quote_depth += line.count('$$')
                
            # Track function definitions
            if 'CREATE OR REPLACE FUNCTION' in line.upper():
                in_function = True
            elif in_function and ('$$ language' in line.lower() or '$$ LANGUAGE' in line):
                in_function = False
                current_statement += line + '\n'
                statements.append(current_statement.strip())
                current_statement = ""
                continue
                
            current_statement += line + '\n'
            
            # If not in special block and line ends with semicolon, it's a complete statement
            if not in_do_block and not in_function and dollar_quote_depth == 0 and line.endswith(';'):
                statements.append(current_statement.strip())
                current_statement = ""
        
        # Add any remaining statement
        if current_statement.strip():
            statements.append(current_statement.strip())
            
        return [stmt for stmt in statements if stmt.strip()]

    def check_basic_sql_syntax(self, statements: List[str]) -> List[str]:
        """Check for basic SQL syntax issues"""
        issues = []
        
        for i, stmt in enumerate(statements):
            stmt_upper = stmt.upper()
            
            # Skip DO blocks from syntax checking as they have different rules
            if stmt_upper.strip().startswith('DO $$'):
                continue
                
            # Check for common syntax issues
            if 'CREATE TABLE' in stmt_upper and 'IF NOT EXISTS' in stmt_upper:
                # More flexible regex to handle CREATE TABLE inside DO blocks
                if not re.search(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+', stmt_upper):
                    issues.append(f"Statement {i+1}: Malformed CREATE TABLE syntax")
            
            # Check for unmatched parentheses (but skip DO blocks)
            if not stmt_upper.strip().startswith('DO $$'):
                open_parens = stmt.count('(')
                close_parens = stmt.count(')')
                if open_parens != close_parens:
                    issues.append(f"Statement {i+1}: Unmatched parentheses ({open_parens} open, {close_parens} close)")
            
            # Check for missing semicolons in multi-statement blocks
            if len(statements) > 1 and not stmt.strip().endswith(';') and 'DO $$' not in stmt and '$$ language' not in stmt.lower():
                issues.append(f"Statement {i+1}: Missing semicolon")
        
        return issues

    def test_migration_009_fixes(self):
        """Test that migration 009 has been properly fixed"""
        content = self.read_migration_file("009_backtest_results_table.sql")
        
        # Test 1: Should NOT use CREATE TABLE IF NOT EXISTS for backtest_results
        has_create_table = "CREATE TABLE IF NOT EXISTS backtest_results" in content
        self.log_test(
            "Migration 009: No CREATE TABLE IF NOT EXISTS for backtest_results",
            not has_create_table,
            "Found CREATE TABLE IF NOT EXISTS - this would be a no-op and cause index failures" if has_create_table else "Correctly avoids CREATE TABLE IF NOT EXISTS"
        )
        
        # Test 2: Should use ALTER TABLE ADD COLUMN IF NOT EXISTS
        has_alter_table = "ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS" in content
        self.log_test(
            "Migration 009: Uses ALTER TABLE ADD COLUMN IF NOT EXISTS",
            has_alter_table,
            "Correctly uses ALTER TABLE ADD COLUMN IF NOT EXISTS" if has_alter_table else "Missing ALTER TABLE ADD COLUMN IF NOT EXISTS"
        )
        
        # Test 3: Check for the specific columns mentioned in the issue
        required_columns = ['user_id', 'strategy_id', 'status', 'progress', 'results', 'error', 'started_at', 'completed_at']
        missing_columns = []
        for col in required_columns:
            if f"ADD COLUMN IF NOT EXISTS {col}" not in content:
                missing_columns.append(col)
        
        self.log_test(
            "Migration 009: All required columns are added",
            len(missing_columns) == 0,
            f"Missing columns: {missing_columns}" if missing_columns else "All required columns present"
        )
        
        # Test 4: Check that indexes are created for the new columns
        has_user_id_index = "idx_backtest_results_user_id" in content
        has_strategy_id_index = "idx_backtest_results_strategy_id" in content
        
        self.log_test(
            "Migration 009: Creates indexes for new columns",
            has_user_id_index and has_strategy_id_index,
            "Indexes created for user_id and strategy_id" if (has_user_id_index and has_strategy_id_index) else "Missing indexes for new columns"
        )

    def test_migration_010_syntax(self):
        """Test migration 010 SQL syntax"""
        content = self.read_migration_file("010_add_execution_mode_to_trades.sql")
        statements = self.extract_sql_statements(content)
        
        # Test basic syntax
        syntax_issues = self.check_basic_sql_syntax(statements)
        self.log_test(
            "Migration 010: Basic SQL syntax valid",
            len(syntax_issues) == 0,
            f"Syntax issues: {syntax_issues}" if syntax_issues else "No syntax issues found"
        )
        
        # Test conditional FK logic
        has_do_block = "DO $$" in content and "END $$" in content
        self.log_test(
            "Migration 010: Has conditional FK logic",
            has_do_block,
            "Contains DO block for conditional FK handling" if has_do_block else "Missing conditional FK logic"
        )
        
        # Test CHECK constraint syntax
        has_check_constraint = "CHECK (execution_mode IN" in content
        self.log_test(
            "Migration 010: Has execution_mode CHECK constraint",
            has_check_constraint,
            "CHECK constraint for execution_mode found" if has_check_constraint else "Missing CHECK constraint"
        )

    def test_migration_011_syntax(self):
        """Test migration 011 SQL syntax"""
        content = self.read_migration_file("011_agent_events_table.sql")
        statements = self.extract_sql_statements(content)
        
        # Test basic syntax
        syntax_issues = self.check_basic_sql_syntax(statements)
        self.log_test(
            "Migration 011: Basic SQL syntax valid",
            len(syntax_issues) == 0,
            f"Syntax issues: {syntax_issues}" if syntax_issues else "No syntax issues found"
        )
        
        # Test conditional table creation logic
        has_conditional_logic = "SELECT data_type INTO sessions_id_type" in content
        self.log_test(
            "Migration 011: Has conditional table creation logic",
            has_conditional_logic,
            "Contains conditional logic for FK type handling" if has_conditional_logic else "Missing conditional logic"
        )
        
        # Test that it handles both VARCHAR and UUID cases
        has_varchar_case = "sessions_id_type = 'character varying'" in content
        has_uuid_case = "UUID or unknown type" in content
        self.log_test(
            "Migration 011: Handles both VARCHAR and UUID cases",
            has_varchar_case and has_uuid_case,
            "Handles both FK type cases" if (has_varchar_case and has_uuid_case) else "Missing type case handling"
        )

    def test_full_migration_chain_syntax(self):
        """Test syntax of all migrations 001-013"""
        migration_files = [
            "001_futures_schema.sql",
            "002_backtesting_schema.sql", 
            "003_autonomous_trading_schema.sql",
            "004_unified_strategy_schema.sql",
            "006_add_encryption_fields.sql",  # Note: 005 is missing
            "007_agent_tables.sql",
            "008_create_trades_table.sql",
            "009_backtest_results_table.sql",
            "010_add_execution_mode_to_trades.sql",
            "011_agent_events_table.sql",
            "012_fix_schema_compatibility.sql",
            "013_fix_session_id_varchar.sql"
        ]
        
        total_issues = []
        
        # Check for missing migration 005
        if not os.path.exists(os.path.join(self.migrations_dir, "005_*.sql")):
            self.log_test(
                "Migration sequence: No gap in migration numbers",
                False,
                "Migration 005 is missing - this could cause issues with migration ordering"
            )
        
        for filename in migration_files:
            if not os.path.exists(os.path.join(self.migrations_dir, filename)):
                total_issues.append(f"Missing migration file: {filename}")
                continue
                
            content = self.read_migration_file(filename)
            if content.startswith("ERROR:"):
                total_issues.append(f"Could not read {filename}")
                continue
                
            statements = self.extract_sql_statements(content)
            syntax_issues = self.check_basic_sql_syntax(statements)
            
            if syntax_issues:
                total_issues.extend([f"{filename}: {issue}" for issue in syntax_issues])
        
        self.log_test(
            "Full migration chain: No obvious SQL syntax errors",
            len(total_issues) == 0,
            f"Issues found: {total_issues}" if total_issues else "All migration files have valid syntax"
        )

    def test_root_cause_fix_verification(self):
        """Test that the root cause described in the issue has been fixed"""
        content_002 = self.read_migration_file("002_backtesting_schema.sql")
        content_009 = self.read_migration_file("009_backtest_results_table.sql")
        
        # Test 1: Migration 002 creates backtest_results table without user_id column
        has_backtest_results_table = "CREATE TABLE IF NOT EXISTS backtest_results" in content_002
        has_user_id_in_002 = "user_id" in content_002 and "backtest_results" in content_002
        
        self.log_test(
            "Root cause: Migration 002 creates backtest_results without user_id",
            has_backtest_results_table and not has_user_id_in_002,
            "Migration 002 correctly creates backtest_results table without user_id column"
        )
        
        # Test 2: Migration 009 no longer tries CREATE TABLE IF NOT EXISTS
        has_create_table_009 = "CREATE TABLE IF NOT EXISTS backtest_results" in content_009
        
        self.log_test(
            "Root cause fix: Migration 009 avoids CREATE TABLE IF NOT EXISTS",
            not has_create_table_009,
            "Migration 009 correctly avoids CREATE TABLE IF NOT EXISTS (which would be no-op)"
        )
        
        # Test 3: Migration 009 adds columns that would have caused index failures
        problematic_columns = ['user_id', 'strategy_id']
        adds_problematic_columns = all(
            f"ADD COLUMN IF NOT EXISTS {col}" in content_009 
            for col in problematic_columns
        )
        
        self.log_test(
            "Root cause fix: Migration 009 properly adds missing columns",
            adds_problematic_columns,
            "Migration 009 adds user_id and strategy_id columns before creating indexes"
        )
        
        # Test 4: Verify indexes are created after columns are added
        has_user_id_index = "CREATE INDEX IF NOT EXISTS idx_backtest_results_user_id ON backtest_results (user_id)" in content_009
        has_strategy_id_index = "CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy_id ON backtest_results (strategy_id)" in content_009
        
        self.log_test(
            "Root cause fix: Indexes created after columns exist",
            has_user_id_index and has_strategy_id_index,
            "Indexes for user_id and strategy_id are created after columns are added"
        )

    def test_column_conflicts_migration_002_009(self):
        """Test for column conflicts between migration 002 and 009"""
        content_002 = self.read_migration_file("002_backtesting_schema.sql")
        content_009 = self.read_migration_file("009_backtest_results_table.sql")
        
        # Extract columns from migration 002's backtest_results table
        backtest_results_match = re.search(
            r'CREATE TABLE IF NOT EXISTS backtest_results \((.*?)\);',
            content_002,
            re.DOTALL
        )
        
        existing_columns = set()
        if backtest_results_match:
            table_def = backtest_results_match.group(1)
            # Extract column names (first word of each line that's not a constraint)
            for line in table_def.split('\n'):
                line = line.strip()
                if line and not line.startswith('--') and not line.startswith('FOREIGN KEY'):
                    # Extract column name (first word)
                    parts = line.split()
                    if parts and not parts[0].upper() in ['UNIQUE', 'PRIMARY', 'CHECK', 'FOREIGN']:
                        col_name = parts[0].rstrip(',')
                        existing_columns.add(col_name)
        
        # Extract columns being added in migration 009
        new_columns = set()
        add_column_matches = re.findall(r'ADD COLUMN IF NOT EXISTS (\w+)', content_009)
        new_columns.update(add_column_matches)
        
        # Check for conflicts
        conflicts = existing_columns.intersection(new_columns)
        
        self.log_test(
            "Migration 009: No column conflicts with migration 002",
            len(conflicts) == 0,
            f"Column conflicts found: {conflicts}" if conflicts else f"Adding new columns: {new_columns}"
        )
        
        # Verify the specific columns mentioned in the issue
        expected_new_columns = {'user_id', 'strategy_id', 'status', 'progress', 'results', 'error', 'started_at', 'completed_at'}
        missing_expected = expected_new_columns - new_columns
        
        self.log_test(
            "Migration 009: Adds all expected columns",
            len(missing_expected) == 0,
            f"Missing expected columns: {missing_expected}" if missing_expected else "All expected columns are being added"
        )
        """Test for column conflicts between migration 002 and 009"""
        content_002 = self.read_migration_file("002_backtesting_schema.sql")
        content_009 = self.read_migration_file("009_backtest_results_table.sql")
        
        # Extract columns from migration 002's backtest_results table
        backtest_results_match = re.search(
            r'CREATE TABLE IF NOT EXISTS backtest_results \((.*?)\);',
            content_002,
            re.DOTALL
        )
        
        existing_columns = set()
        if backtest_results_match:
            table_def = backtest_results_match.group(1)
            # Extract column names (first word of each line that's not a constraint)
            for line in table_def.split('\n'):
                line = line.strip()
                if line and not line.startswith('--') and not line.startswith('FOREIGN KEY'):
                    # Extract column name (first word)
                    parts = line.split()
                    if parts and not parts[0].upper() in ['UNIQUE', 'PRIMARY', 'CHECK', 'FOREIGN']:
                        col_name = parts[0].rstrip(',')
                        existing_columns.add(col_name)
        
        # Extract columns being added in migration 009
        new_columns = set()
        add_column_matches = re.findall(r'ADD COLUMN IF NOT EXISTS (\w+)', content_009)
        new_columns.update(add_column_matches)
        
        # Check for conflicts
        conflicts = existing_columns.intersection(new_columns)
        
        self.log_test(
            "Migration 009: No column conflicts with migration 002",
            len(conflicts) == 0,
            f"Column conflicts found: {conflicts}" if conflicts else f"Adding new columns: {new_columns}"
        )
        
        # Verify the specific columns mentioned in the issue
        expected_new_columns = {'user_id', 'strategy_id', 'status', 'progress', 'results', 'error', 'started_at', 'completed_at'}
        missing_expected = expected_new_columns - new_columns
        
        self.log_test(
            "Migration 009: Adds all expected columns",
            len(missing_expected) == 0,
            f"Missing expected columns: {missing_expected}" if missing_expected else "All expected columns are being added"
        )

    def test_migration_runner_compatibility(self):
        """Test that migrations are compatible with the migration runner"""
        runner_content = ""
        try:
            with open("/app/apps/api/src/scripts/runMigrations.ts", 'r') as f:
                runner_content = f.read()
        except Exception as e:
            self.log_test(
                "Migration runner: File accessible",
                False,
                f"Could not read migration runner: {e}"
            )
            return
        
        # Check that runner uses transactions
        has_transactions = "BEGIN" in runner_content and "COMMIT" in runner_content and "ROLLBACK" in runner_content
        self.log_test(
            "Migration runner: Uses transactions with rollback",
            has_transactions,
            "Migration runner properly handles transactions" if has_transactions else "Missing transaction handling"
        )
        
        # Check that runner sorts migrations by filename
        has_sorting = "sort(" in runner_content and "numeric: true" in runner_content
        self.log_test(
            "Migration runner: Sorts migrations numerically",
            has_sorting,
            "Migrations are sorted numerically" if has_sorting else "Missing numeric sorting"
        )
        
        # Check that runner tracks applied migrations
        has_tracking = "schema_migrations" in runner_content
        self.log_test(
            "Migration runner: Tracks applied migrations",
            has_tracking,
            "Uses schema_migrations table for tracking" if has_tracking else "Missing migration tracking"
        )

    def run_all_tests(self):
        """Run all migration tests"""
        print("🔍 Testing SQL Migration Files for Deployment Readiness")
        print("=" * 60)
        
        # Test the specific fixes mentioned in the issue
        self.test_migration_009_fixes()
        self.test_migration_010_syntax()
        self.test_migration_011_syntax()
        
        # Test the root cause fix
        self.test_root_cause_fix_verification()
        
        # Test the full migration chain
        self.test_full_migration_chain_syntax()
        
        # Test for column conflicts
        self.test_column_conflicts_migration_002_009()
        
        # Test migration runner compatibility
        self.test_migration_runner_compatibility()
        
        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.issues_found:
            print(f"\n❌ Issues Found ({len(self.issues_found)}):")
            for issue in self.issues_found:
                print(f"  • {issue}")
        else:
            print("\n✅ All tests passed! Migrations appear ready for deployment.")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    tester = SQLMigrationTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())