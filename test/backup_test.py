import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'scripts/postgres-backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafety(unittest.TestCase):
    def test_remote_tls_verification_required(self):
        env = backup.source_env('postgresql://user:private@dpg-example.frankfurt-postgres.render.com/velora')
        self.assertEqual(env['PGSSLMODE'], 'verify-full')
        self.assertIn('default_transaction_read_only=on', env['PGOPTIONS'])
        for mode in ['disable', 'require', 'prefer', 'verify-ca']:
            with self.assertRaises(ValueError):
                backup.source_env('postgresql://user:private@dpg-example.render.com/velora?sslmode=' + mode)

    def test_only_expected_remote_destination(self):
        for host in ['attacker.example', 'render.com.attacker.example', '127.0.0.1']:
            with self.assertRaises(ValueError):
                backup.source_env('postgresql://user:private@' + host + '/velora')

    def test_local_test_cannot_dump_arbitrary_database(self):
        for url in ['postgresql://user@127.0.0.1/velora',
                    'postgresql://user@dpg-example.render.com/velora_accounts_test_x']:
            with self.assertRaises(ValueError):
                backup.source_env(url, local_test=True)
        self.assertEqual(backup.source_env('postgresql://user@127.0.0.1/velora_accounts_test_x', True)['PGHOST'], '127.0.0.1')

    def test_environment_cannot_override_destination_or_inject_options(self):
        with patch.dict('os.environ', {'PGHOSTADDR':'198.51.100.1', 'PGSERVICE':'other', 'PGOPTIONS':'unsafe'}):
            env=backup.source_env('postgresql://user:private@dpg-example.render.com/velora')
        self.assertNotIn('PGHOSTADDR',env)
        self.assertNotIn('PGSERVICE',env)
        self.assertNotIn('unsafe',env['PGOPTIONS'])
        with self.assertRaises(ValueError):
            backup.source_env('postgresql://user:private@dpg-example.render.com/velora?options=unsafe')

    def test_password_never_appears_in_client_command_arguments(self):
        env=backup.source_env('postgresql://user:private@dpg-example.render.com/velora')
        args=backup.client_command('pg_dump','local-container',env)
        self.assertNotIn('private',' '.join(args))
        self.assertNotIn('postgresql://',' '.join(args))
        self.assertIn('PGPASSWORD',args)

    def test_client_error_does_not_expose_stderr(self):
        import subprocess
        result=subprocess.CompletedProcess([],1,stdout=b'',stderr=b'private credentials')
        with patch.object(backup.subprocess,'run',return_value=result):
            with self.assertRaises(RuntimeError) as error:
                backup.execute(['pg_dump'])
        self.assertNotIn('private',str(error.exception))


if __name__ == '__main__':
    unittest.main()
