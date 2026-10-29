import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export const provenanceKey = 'zwaveJsDriverSource'

export function readJson(filename) {
	return JSON.parse(readFileSync(filename, 'utf8'))
}

export function validateSource(source) {
	if (
		source?.schemaVersion !== 1 ||
		!['git', 'npm'].includes(source.source)
	) {
		throw new Error(
			'driver-source.json must select schemaVersion 1 and source git or npm',
		)
	}
	if (source.source === 'git') {
		const repository = new URL(source.repository)
		if (
			repository.protocol !== 'https:' ||
			repository.username ||
			repository.password
		) {
			throw new Error(
				'The driver repository must be an HTTPS URL without credentials',
			)
		}
		if (!/^[a-f0-9]{40}$/.test(source.commit)) {
			throw new Error(
				'The driver source must pin a full lowercase Git commit hash',
			)
		}
		if (!/^yarn@\d+\.\d+\.\d+$/.test(source.packageManager)) {
			throw new Error(
				'The driver source must pin an exact Yarn package manager version',
			)
		}
		return {
			schemaVersion: 1,
			source: 'git',
			repository: repository.href,
			commit: source.commit,
			packageManager: source.packageManager,
		}
	}
	return { schemaVersion: 1, source: 'npm' }
}

export function sameSource(left, right) {
	return (
		left?.source === right.source &&
		left?.repository === right.repository &&
		left?.commit === right.commit &&
		left?.packageManager === right.packageManager
	)
}

export function packageDirectory(fromDirectory, name) {
	const require = createRequire(path.join(fromDirectory, 'package.json'))
	try {
		return path.dirname(require.resolve(`${name}/package.json`))
	} catch {
		let directory = path.dirname(require.resolve(name))
		while (path.dirname(directory) !== directory) {
			try {
				if (
					readJson(path.join(directory, 'package.json')).name === name
				)
					return directory
			} catch {
				/* Not every entry-point ancestor is a package. */
			}
			directory = path.dirname(directory)
		}
		throw new Error(`Cannot locate package ${name}`)
	}
}

export function packageHash(directory) {
	const hash = createHash('sha256')
	const visit = (relative) => {
		const current = path.join(directory, relative)
		for (const entry of readdirSync(current, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name, 'en'),
		)) {
			if (entry.name === 'node_modules') continue
			const filename = path.join(current, entry.name)
			const child = path.posix.join(relative, entry.name)
			if (entry.isSymbolicLink())
				throw new Error(`Unexpected package symlink: ${filename}`)
			if (entry.isDirectory()) visit(child)
			else if (entry.isFile()) {
				hash.update(child)
					.update('\0')
					.update(readFileSync(filename))
					.update('\0')
			}
		}
	}
	visit('')
	return hash.digest('hex')
}

export function verifyGraph(root, names) {
	const canonical = new Map(
		names.map((name) => {
			const directory = packageDirectory(root, name)
			const expected = path.join(root, 'node_modules', ...name.split('/'))
			if (
				lstatSync(expected).isSymbolicLink() ||
				realpathSync(directory) !== realpathSync(expected)
			) {
				throw new Error(
					`Driver package ${name} must be installed directly, without a checkout symlink`,
				)
			}
			return [name, realpathSync(directory)]
		}),
	)
	const roots = new Set([
		...names,
		...Object.keys(
			readJson(path.join(root, 'package.json')).dependencies ?? {},
		),
	])
	for (const name of roots) {
		const directory = packageDirectory(root, name)
		const info = readJson(path.join(directory, 'package.json'))
		const edges = { ...info.dependencies, ...info.peerDependencies }
		for (const dependency of Object.keys(edges)) {
			if (!canonical.has(dependency)) continue
			if (
				realpathSync(packageDirectory(directory, dependency)) !==
				canonical.get(dependency)
			) {
				throw new Error(
					`Mixed driver packages: ${name} resolves a different ${dependency}`,
				)
			}
		}
	}
	return canonical
}

export function verifyInstalledSource(root, source, installation) {
	const ui = readJson(path.join(root, 'package.json'))
	const driver = readJson(
		path.join(packageDirectory(root, 'zwave-js'), 'package.json'),
	)
	if (driver.version !== ui.dependencies['zwave-js']) {
		throw new Error(
			'The selected driver must match the exact zwave-js version in package.json',
		)
	}
	if (source.source === 'npm') {
		const names = new Set([
			'zwave-js',
			...(installation?.packages?.map((entry) => entry.name) ?? []),
		])
		for (const name of names) {
			if (
				readJson(
					path.join(packageDirectory(root, name), 'package.json'),
				)[provenanceKey]
			) {
				throw new Error(
					'A Git driver is installed while npm source is selected',
				)
			}
		}
		return { source: 'npm', version: driver.version }
	}
	if (
		!installation ||
		installation.schemaVersion !== 1 ||
		!sameSource(installation.selection, source)
	) {
		throw new Error('The selected Git driver has not been prepared')
	}
	if (
		!Array.isArray(installation.packages) ||
		!installation.packages.some((entry) => entry.name === 'zwave-js')
	) {
		throw new Error(
			'The driver installation manifest has no Driver package',
		)
	}
	const directories = verifyGraph(
		root,
		installation.packages.map((entry) => entry.name),
	)
	for (const expected of installation.packages) {
		const directory = directories.get(expected.name)
		const actual = readJson(path.join(directory, 'package.json'))
		if (
			!sameSource(actual[provenanceKey], source) ||
			actual.version !== expected.version
		) {
			throw new Error(
				`Wrong driver source installed for ${expected.name}`,
			)
		}
		if (packageHash(directory) !== expected.sha256) {
			throw new Error(`Driver package contents changed: ${expected.name}`)
		}
	}
	return { source: 'git', version: driver.version, commit: source.commit }
}

export function dependencyClosure(packages, name = 'zwave-js') {
	const selected = new Set()
	const visit = (current) => {
		if (selected.has(current)) return
		const item = packages.get(current)
		if (!item) throw new Error(`No packed workspace package: ${current}`)
		selected.add(current)
		for (const dependency of Object.keys(item.info.dependencies ?? {})) {
			if (packages.has(dependency)) visit(dependency)
		}
	}
	visit(name)
	return [...selected].sort()
}
