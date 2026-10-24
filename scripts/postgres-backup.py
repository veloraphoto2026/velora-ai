#!/usr/bin/env python3
"""Read-only source dump; restoration only into a new network-isolated local container."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit, parse_qs, unquote
import uuid

IMAGE = 'postgres:17@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
ROOT = Path(__file__).resolve().parents[1]


def source_env(url, local_test=False):
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or parsed.fragment:
        raise ValueError('A valid PostgreSQL URL is required in BACKUP_DATABASE_URL')
    host = parsed.hostname
    database = unquote(parsed.path.lstrip('/'))
    if local_test:
        if host not in ('127.0.0.1', 'localhost') or not database.startswith('velora_accounts_test_'):
            raise ValueError('Local tests require loopback and a velora_accounts_test_* database')
    elif not host.endswith('.render.com'):
        raise ValueError('Production source must be an external Render hostname ending in .render.com')
    options = parse_qs(parsed.query, keep_blank_values=True)
    if set(options) - {'sslmode', 'sslrootcert'} or any(len(v) != 1 for v in options.values()):
        raise ValueError('Unsupported or duplicate connection URL options')
    if not local_test and options.get('sslmode', ['verify-full'])[0] != 'verify-full':
        raise ValueError('Remote backups require sslmode=verify-full; TLS verification will not be disabled')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=host, PGPORT=str(parsed.port or 5432), PGDATABASE=database,
               PGUSER=unquote(parsed.username or ''), PGPASSWORD=unquote(parsed.password or ''),
               PGSSLMODE='disable' if local_test else 'verify-full', PGCONNECT_TIMEOUT='15',
               PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0 -c lock_timeout=10000')
    if not database or not env['PGUSER'] or (not local_test and not env['PGPASSWORD']):
        raise ValueError('Database, username and remote password must be supplied securely')
    if 'sslrootcert' in options:
        env['PGSSLROOTCERT'] = options['sslrootcert'][0]
    return env


def execute(command, *, env=None, stdin=None, stdout=subprocess.PIPE):
    # Never print command environments or raw stderr: clients may include connection details.
    result = subprocess.run(command, env=env, stdin=stdin, stdout=stdout, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('PostgreSQL/Docker operation failed; exit code %s (credentials and raw output withheld)' % result.returncode)
    return result.stdout


def client_command(binary, container, env):
    if not container:
        return [binary]
    command = ['docker', 'exec', '-i']
    for key in env:
        if key.startswith('PG'):
            command.extend(['--env', key])
    return command + [container, binary]


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def dump(args):
    env = source_env(os.environ.get('BACKUP_DATABASE_URL', ''), args.local_test)
    directory = Path(args.output_dir).resolve()
    if directory == ROOT or ROOT in directory.parents:
        raise ValueError('Backups must be stored outside the repository')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Refuse an existing shared directory rather than changing its permissions.
    if directory.stat().st_mode & 0o077:
        raise ValueError('Backup output directory must have mode 700')
    filename = 'velora-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex
    partial = directory / (filename + '.dump.partial')
    version = execute(client_command('pg_dump', args.client_container, env) + ['--version'], env=env).decode().strip()
    with partial.open('xb') as stream:
        execute(client_command('pg_dump', args.client_container, env) +
                ['--format=custom', '--no-owner', '--no-privileges', '--no-password'], env=env, stdout=stream)
        stream.flush()
        os.fsync(stream.fileno())
    if not partial.stat().st_size:
        raise RuntimeError('Empty dump; partial artifact retained')
    with partial.open('rb') as stream:
        catalog = execute(client_command('pg_restore', args.client_container, env) + ['--list'], env=env, stdin=stream)
    final = directory / (filename + '.dump')
    partial.rename(final)
    manifest = {'source': 'local-test' if args.local_test else 'render', 'source_host': env['PGHOST'],
                'database': env['PGDATABASE'], 'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'pg_dump_version': version, 'sha256': digest(final), 'bytes': final.stat().st_size,
                'restore_verified': False}
    Path(str(final) + '.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    Path(str(final) + '.catalog').write_bytes(catalog)
    print(json.dumps({'backup_file': str(final), 'source': manifest['source'], 'restore_verified': False}))


def verify(args):
    path = Path(args.dump).resolve()
    manifest = json.loads(Path(str(path) + '.manifest.json').read_text())
    if digest(path) != manifest['sha256']:
        raise ValueError('Checksum mismatch: refusing restore')
    name = 'velora-backup-verify-' + uuid.uuid4().hex[:12]
    execute(['docker', 'run', '-d', '--name', name, '--network', 'none',
             '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
    completed = False
    try:
        for attempt in range(30):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Isolated verification PostgreSQL did not become ready')
        execute(['docker', 'exec', name, 'createdb', '-U', 'postgres', 'velora_restore_check'])
        with path.open('rb') as stream:
            execute(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'postgres',
                     '-d', 'velora_restore_check', '--exit-on-error', '--no-owner', '--no-privileges'], stdin=stream)
        query = "SELECT count(*) FROM public.users; SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position;"
        lines = execute(['docker', 'exec', name, 'psql', '-U', 'postgres', '-d', 'velora_restore_check',
                         '-v', 'ON_ERROR_STOP=1', '-Atc', query]).decode().splitlines()
        required = {'id', 'email', 'password_hash', 'credits', 'created_at'}
        if not lines or not required.issubset(set(lines[1:])):
            raise RuntimeError('Restored database lacks the required users schema')
        report = {'sha256': manifest['sha256'], 'restore_verified': True,
                  'verified_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'source': manifest['source'], 'users_count': int(lines[0]),
                  'verification_container': name, 'network': 'none', 'source_database_unchanged': True}
        # Separate result files preserve the original creation manifest.
        result_path = Path(str(path) + '.' + name + '.verified.json')
        result_path.write_text(json.dumps(report, indent=2) + '\n')
        completed = True
        print(json.dumps({'restore_verified': True, 'source': manifest['source'], 'report': str(result_path)}))
    finally:
        execute(['docker', 'stop', name])
        print(json.dumps({'verification_container_retained': name, 'stopped': True, 'restore_completed': completed}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    backup = sub.add_parser('dump')
    backup.add_argument('--output-dir', required=True)
    backup.add_argument('--client-container', help='Optional existing local PostgreSQL client container; passwords passed via environment, not command arguments')
    backup.add_argument('--local-test', action='store_true')
    backup.set_defaults(function=dump)
    restore = sub.add_parser('verify-local')
    restore.add_argument('dump')
    restore.set_defaults(function=verify)
    args = parser.parse_args()
    args.function(args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # URL parsing exceptions can contain input. Only known static validation messages are safe.
        if isinstance(error, (ValueError, RuntimeError)) and not isinstance(error, json.JSONDecodeError):
            message = str(error) if str(error).startswith(('A valid', 'Local tests', 'Production source', 'Unsupported', 'Remote backups', 'Database,', 'Backups must', 'Backup output', 'Checksum mismatch', 'Empty dump', 'PostgreSQL/Docker', 'Isolated verification', 'Restored database')) else type(error).__name__
        else:
            message = type(error).__name__
        print('Backup operation failed: ' + message, file=sys.stderr)
        sys.exit(1)
