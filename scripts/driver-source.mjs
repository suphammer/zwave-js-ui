import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	rmSync,
	writeFileSync,
	renameSync,
	readdirSync,
	lstatSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
	dependencyClosure,
	packageDirectory,
	packageHash,
	provenanceKey,
	readJson,
	validateSource,
	verifyGraph,
	verifyInstalledSource,
} from './driver-source-utils.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = path.join(root, '.driver-source')
const installedFile = path.join(cache, 'installed.json')
const selection = validateSource(
	readJson(path.join(root, 'driver-source.json')),
)
const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: { seed: { type: 'string' }, 'skip-npm-ci': { type: 'boolean' } },
})

function run(command, args, cwd = root, capture = false, env = process.env) {
	console.log(`Driver source: ${command} ${args.join(' ')}`)
	return execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		env,
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
	})?.trim()
}

function verify() {
	let installation
	if (existsSync(installedFile)) installation = readJson(installedFile)
	const result = verifyInstalledSource(root, selection, installation)
	console.log(
		`Verified ${result.source} Z-Wave JS ${result.version}${result.commit ? ` at ${result.commit}` : ''}`,
	)
}

function checkout() {
	const source = path.join(cache, 'source')
	const ownerFile = path.join(cache, 'owner.json')
	if (existsSync(source) && lstatSync(source).isSymbolicLink()) {
		throw new Error(
			'The managed source directory must not be a checkout symlink',
		)
	}
	if (
		existsSync(source) &&
		(!existsSync(ownerFile) ||
			readJson(ownerFile).owner !== 'zwave-js-ui-driver-source')
	) {
		throw new Error(
			'Refusing to modify an unmanaged driver source directory',
		)
	}
	if (!existsSync(source)) {
		if (values.seed) {
			const seed = path.resolve(values.seed)
			if (
				run('git', ['rev-parse', 'HEAD'], seed, true) !==
					selection.commit ||
				run(
					'git',
					['status', '--porcelain', '--untracked-files=no'],
					seed,
					true,
				)
			) {
				throw new Error(
					'The seed checkout must be clean and at the selected commit',
				)
			}
			run('git', [
				'clone',
				'--no-hardlinks',
				'--no-checkout',
				seed,
				source,
			])
			run(
				'git',
				['remote', 'set-url', 'origin', selection.repository],
				source,
			)
		} else {
			mkdirSync(source)
			run('git', ['init'], source)
			run(
				'git',
				['remote', 'add', 'origin', selection.repository],
				source,
			)
		}
		writeFileSync(
			ownerFile,
			JSON.stringify({ owner: 'zwave-js-ui-driver-source' }) + '\n',
		)
	}
	if (
		run('git', ['remote', 'get-url', 'origin'], source, true) !==
			selection.repository ||
		(existsSync(path.join(source, '.git/index')) &&
			run(
				'git',
				['status', '--porcelain', '--untracked-files=no'],
				source,
				true,
			))
	) {
		throw new Error(
			'The managed driver checkout has a changed remote or tracked files',
		)
	}
	try {
		run(
			'git',
			['cat-file', '-e', `${selection.commit}^{commit}`],
			source,
			true,
		)
	} catch {
		run(
			'git',
			['fetch', '--depth', '1', 'origin', selection.commit],
			source,
		)
	}
	run('git', ['checkout', '--detach', selection.commit], source)
	if (run('git', ['rev-parse', 'HEAD'], source, true) !== selection.commit)
		throw new Error('Driver Git identity mismatch')
	return source
}

async function bootstrap() {
	mkdirSync(cache, { recursive: true })
	// Corepack downloads CommonJS yarn.js files below this ESM application.
	writeFileSync(
		path.join(cache, 'package.json'),
		JSON.stringify({ private: true, type: 'commonjs' }) + '\n',
	)
	const lockFile = path.join(cache, 'bootstrap.lock')
	const lock = openSync(lockFile, 'wx')
	try {
		rmSync(installedFile, { force: true })
		if (!values['skip-npm-ci']) run('npm', ['ci'])
		if (selection.source === 'npm') {
			verify()
			return
		}
		const source = checkout()
		if (
			readJson(path.join(source, 'package.json')).packageManager !==
			selection.packageManager
		) {
			throw new Error(
				'The selected checkout has a different package manager pin',
			)
		}
		const tooling = path.join(cache, 'tooling')
		const corepack = path.join(tooling, 'node_modules/corepack')
		if (
			!existsSync(path.join(corepack, 'package.json')) ||
			readJson(path.join(corepack, 'package.json')).version !== '0.34.0'
		) {
			run('npm', [
				'install',
				'--prefix',
				tooling,
				'--no-save',
				'--package-lock=false',
				'corepack@0.34.0',
			])
		}
		const yarnEnvironment = {
			...process.env,
			PATH: `${path.join(tooling, 'node_modules/.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
			COREPACK_HOME: path.join(cache, 'corepack-cache'),
			HUSKY: '0',
		}
		const yarn = (args) =>
			run(
				process.execPath,
				[path.join(corepack, 'dist/yarn.js'), ...args],
				source,
				false,
				yarnEnvironment,
			)
		yarn(['install', '--immutable'])
		// Upstream clean scripts reject an unmatched tsbuildinfo glob on fresh clones.
		// Only generated output inside this managed clone is eligible for removal.
		for (const entry of readdirSync(path.join(source, 'packages'), {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) continue
			const workspace = path.join(source, 'packages', entry.name)
			if (!existsSync(path.join(workspace, 'package.json'))) continue
			rmSync(path.join(workspace, 'build'), {
				recursive: true,
				force: true,
			})
			for (const filename of readdirSync(workspace).filter((name) =>
				name.endsWith('.tsbuildinfo'),
			)) {
				rmSync(path.join(workspace, filename))
			}
		}
		yarn(['turbo', 'run', 'bootstrap', '--concurrency=1'])
		yarn(['build'])
		const tarballs = path.join(cache, 'packages')
		rmSync(tarballs, { recursive: true, force: true })
		yarn(['monopack', '--no-version', '--target', tarballs])
		if (
			run(
				'git',
				['status', '--porcelain', '--untracked-files=no'],
				source,
				true,
			)
		)
			throw new Error('Building changed tracked driver source files')

		const requireSource = createRequire(path.join(source, 'package.json'))
		const requireMonopack = createRequire(
			requireSource.resolve('@alcalzone/monopack/package.json'),
		)
		const tar = requireMonopack('tar')
		const packages = new Map()
		for (const filename of readdirSync(tarballs)
			.filter((entry) => entry.endsWith('.tgz'))
			.sort()) {
			const archive = path.join(tarballs, filename)
			const temporary = path.join(cache, 'unpack')
			rmSync(temporary, { recursive: true, force: true })
			mkdirSync(temporary)
			await tar.extract({ file: archive, cwd: temporary })
			const manifestFile = path.join(temporary, 'package', 'package.json')
			const info = readJson(manifestFile)
			info[provenanceKey] = selection
			writeFileSync(manifestFile, JSON.stringify(info, null, 2) + '\n')
			await tar.create(
				{
					file: archive,
					cwd: temporary,
					portable: true,
					mtime: new Date('1985-10-26T08:15:00Z'),
					gzip: { level: 9 },
				},
				['package'],
			)
			packages.set(info.name, { info, archive })
			rmSync(temporary, { recursive: true, force: true })
		}
		const names = dependencyClosure(packages)
		// Install the whole closure together, so npm cannot prune an earlier unsaved overlay.
		run('npm', [
			'install',
			'--no-save',
			...names.map((name) => packages.get(name).archive),
		])
		verifyGraph(root, names)
		const installation = {
			schemaVersion: 1,
			selection,
			nodeVersion: process.versions.node,
			npmVersion: run('npm', ['--version'], root, true),
			packages: names.map((name) => ({
				name,
				version: packages.get(name).info.version,
				sha256: packageHash(packageDirectory(root, name)),
			})),
		}
		verifyInstalledSource(root, selection, installation)
		const temporary = `${installedFile}.tmp`
		writeFileSync(temporary, JSON.stringify(installation, null, 2) + '\n')
		renameSync(temporary, installedFile)
		verify()
	} finally {
		closeSync(lock)
		rmSync(lockFile, { force: true })
	}
}

async function main() {
	try {
		if (positionals[0] === 'bootstrap') await bootstrap()
		else if (positionals[0] === 'verify') verify()
		else
			throw new Error(
				'Usage: node scripts/driver-source.mjs bootstrap [--seed ../zwave-js] [--skip-npm-ci] | verify',
			)
	} catch (error) {
		console.error(
			`Driver source: ${error.message}\nRun npm run driver-source:bootstrap to prepare the selected source.`,
		)
		process.exitCode = 1
	}
}

main()
