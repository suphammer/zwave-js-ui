import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	dependencyClosure,
	packageHash,
	provenanceKey,
	validateSource,
	verifyInstalledSource,
} from '../../scripts/driver-source-utils.mjs'

const selection = {
	schemaVersion: 1,
	source: 'git',
	repository: 'https://github.com/example/zwave-js.git',
	commit: 'a'.repeat(40),
	packageManager: 'yarn@4.18.1',
}

describe('Driver source selection', () => {
	let root: string
	const info = (name: string, extra = {}) => ({
		name,
		version: '15.31.2',
		main: 'index.js',
		...extra,
	})
	function writePackage(directory: string, manifest) {
		mkdirSync(directory, { recursive: true })
		writeFileSync(
			path.join(directory, 'package.json'),
			JSON.stringify(manifest),
		)
		writeFileSync(
			path.join(directory, 'index.js'),
			'export const value = 1\n',
		)
	}
	const directory = (name: string) =>
		path.join(root, 'node_modules', ...name.split('/'))
	const metadata = () => ({
		schemaVersion: 1,
		selection,
		packages: ['zwave-js', '@zwave-js/core'].map((name) => ({
			name,
			version: '15.31.2',
			sha256: packageHash(directory(name)),
		})),
	})

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'zui-driver-source-'))
		writeFileSync(
			path.join(root, 'package.json'),
			JSON.stringify({
				dependencies: {
					'zwave-js': '15.31.2',
					'@zwave-js/server': '3.11.0',
				},
			}),
		)
		writePackage(
			directory('zwave-js'),
			info('zwave-js', {
				dependencies: { '@zwave-js/core': 'file:core.tgz' },
				[provenanceKey]: selection,
			}),
		)
		writePackage(
			directory('@zwave-js/core'),
			info('@zwave-js/core', { [provenanceKey]: selection }),
		)
		writePackage(
			directory('@zwave-js/server'),
			info('@zwave-js/server', {
				peerDependencies: { 'zwave-js': '^15.31.0' },
			}),
		)
	})
	afterEach(() => rmSync(root, { recursive: true, force: true }))

	it('requires exact Git and package-manager pins without URL credentials', () => {
		expect(validateSource(selection)).toEqual(selection)
		expect(validateSource({ schemaVersion: 1, source: 'npm' })).toEqual({
			schemaVersion: 1,
			source: 'npm',
		})
		for (const commit of ['main', 'a123456', '', null]) {
			expect(() => validateSource({ ...selection, commit })).toThrow(
				'full lowercase Git commit',
			)
		}
		expect(() =>
			validateSource({
				...selection,
				repository: 'https://user:secret@example.com/repo',
			}),
		).toThrow('without credentials')
		expect(() =>
			validateSource({ ...selection, packageManager: 'yarn@latest' }),
		).toThrow('exact Yarn')
	})

	it('verifies a complete coherent Git source and rejects an npm reinstall', () => {
		const installed = metadata()
		expect(verifyInstalledSource(root, selection, installed)).toEqual({
			source: 'git',
			version: '15.31.2',
			commit: selection.commit,
		})
		writePackage(directory('zwave-js'), info('zwave-js'))
		expect(() => verifyInstalledSource(root, selection, installed)).toThrow(
			'Wrong driver source',
		)
	})

	it('rejects missing preparation, another Git revision and changed compiled code', () => {
		expect(() => verifyInstalledSource(root, selection, undefined)).toThrow(
			'not been prepared',
		)
		const installed = metadata()
		expect(() =>
			verifyInstalledSource(
				root,
				{ ...selection, commit: 'b'.repeat(40) },
				installed,
			),
		).toThrow('not been prepared')
		writeFileSync(path.join(directory('zwave-js'), 'index.js'), 'changed')
		expect(() => verifyInstalledSource(root, selection, installed)).toThrow(
			'contents changed',
		)
	})

	it('rejects a nested stock workspace dependency', () => {
		const installed = metadata()
		const nested = path.join(
			directory('zwave-js'),
			'node_modules/@zwave-js/core',
		)
		writePackage(nested, info('@zwave-js/core'))
		expect(() => verifyInstalledSource(root, selection, installed)).toThrow(
			'different @zwave-js/core',
		)
	})

	it('rejects another server Driver instance', () => {
		const installed = metadata()
		writePackage(
			path.join(directory('@zwave-js/server'), 'node_modules/zwave-js'),
			info('zwave-js'),
		)
		expect(() => verifyInstalledSource(root, selection, installed)).toThrow(
			'different zwave-js',
		)
	})

	it('requires the published source after selecting npm mode', () => {
		const source = { schemaVersion: 1, source: 'npm' }
		const installed = metadata()
		expect(() => verifyInstalledSource(root, source, installed)).toThrow(
			'Git driver is installed',
		)
		writePackage(directory('zwave-js'), info('zwave-js'))
		expect(() => verifyInstalledSource(root, source, installed)).toThrow(
			'Git driver is installed',
		)
		writePackage(directory('@zwave-js/core'), info('@zwave-js/core'))
		expect(verifyInstalledSource(root, source, installed)).toEqual({
			source: 'npm',
			version: '15.31.2',
		})
	})

	it('packs only the runtime workspace closure, including cycles once', () => {
		const packages = new Map([
			[
				'zwave-js',
				{
					info: {
						dependencies: { '@zwave-js/core': '*', external: '*' },
					},
				},
			],
			['@zwave-js/core', { info: { dependencies: { 'zwave-js': '*' } } }],
			['unrelated', { info: {} }],
		])
		expect(dependencyClosure(packages)).toEqual([
			'@zwave-js/core',
			'zwave-js',
		])
	})
})
