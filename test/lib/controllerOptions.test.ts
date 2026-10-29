import { describe, expect, it } from 'vitest'
import { ZWaveErrorCodes } from '@zwave-js/core'
import type { PartialZWaveOptions } from 'zwave-js'
import { applyControllerOptions } from '../../api/lib/controllerOptions.ts'

describe('controller options', () => {
	it('preserves existing Serial API defaults and explicitly selected options', () => {
		for (const controller of [undefined, { type: 'serial-api' as const }]) {
			const options: PartialZWaveOptions = {
				controller,
				features: { softReset: true, watchdog: true },
			}
			const expected = structuredClone(options)
			applyControllerOptions(options)
			expect(options).toEqual(expected)
		}
	})

	it('uses Suphacap without enabling incompatible UI defaults', () => {
		const options: PartialZWaveOptions = {
			controller: { type: 'suphacap', inclusionChannel: 1 },
			rf: { region: 0 },
			storage: { cacheDir: '/cache' },
			features: {
				softReset: true,
				watchdog: true,
				unresponsiveControllerRecovery: true,
			},
		}
		applyControllerOptions(options)
		expect(options).toEqual({
			controller: { type: 'suphacap', inclusionChannel: 1 },
			rf: { region: 0 },
			storage: { cacheDir: '/cache' },
			features: {
				softReset: false,
				watchdog: false,
				unresponsiveControllerRecovery: false,
			},
		})
	})

	it.each([
		'softReset',
		'watchdog',
		'unresponsiveControllerRecovery',
	] as const)('rejects an explicit unsupported %s override', (feature) => {
		const options: PartialZWaveOptions = {
			controller: { type: 'suphacap' },
		}
		expect(() =>
			applyControllerOptions(options, {
				features: { [feature]: true },
			}),
		).toThrow(`options.features.${feature}`)
	})

	it('accepts explicit disabled firmware features', () => {
		const options: PartialZWaveOptions = {
			controller: { type: 'suphacap' },
		}
		applyControllerOptions(options, {
			features: {
				softReset: false,
				watchdog: false,
				unresponsiveControllerRecovery: false,
			},
		})
		expect(options.features.watchdog).toBe(false)
	})

	it.each([null, false, []])(
		'rejects malformed native features %j',
		(features) => {
			expect(() =>
				applyControllerOptions({ controller: { type: 'suphacap' } }, {
					features,
				} as PartialZWaveOptions),
			).toThrow('options.features must be an object')
		},
	)

	it('keeps the RF region without applying Serial API power defaults', () => {
		const rf = {
			region: 0,
			txPower: { powerlevel: 'auto' as const, measured0dBm: 0 },
			maxLongRangePowerlevel: 'auto' as const,
		}
		const options: PartialZWaveOptions = {
			controller: { type: 'suphacap' },
			rf,
		}
		applyControllerOptions(options)
		expect(options.rf).toEqual({ region: 0 })
		expect(rf.txPower.powerlevel).toBe('auto')
	})

	it('leaves Serial API power configuration untouched', () => {
		const options: PartialZWaveOptions = {
			controller: { type: 'serial-api' },
			rf: { txPower: { powerlevel: 5 }, maxLongRangePowerlevel: 'auto' },
		}
		const expected = structuredClone(options)
		applyControllerOptions(options)
		expect(options).toEqual(expected)
	})

	it.each([
		{ txPower: { powerlevel: 5 } },
		{ maxLongRangePowerlevel: 'auto' as const },
	])('rejects an explicit native power override %j', (rf) => {
		expect(() =>
			applyControllerOptions(
				{ controller: { type: 'suphacap' } },
				{ rf },
			),
		).toThrow('power')
	})

	it.each([null, [], 'suphacap', {}, { type: 'other' }])(
		'rejects an invalid controller selection %j',
		(controller) => {
			expect(() =>
				applyControllerOptions({
					controller,
				} as PartialZWaveOptions),
			).toThrow('Controller type')
		},
	)

	it('reports configuration errors without scheduling a reconnect loop', () => {
		try {
			applyControllerOptions(
				{ controller: { type: 'suphacap' } },
				{
					features: { watchdog: true },
				},
			)
		} catch (error) {
			expect(error).toMatchObject({
				code: ZWaveErrorCodes.Driver_InvalidOptions,
			})
			return
		}
		throw new Error('Expected invalid controller options')
	})
})
