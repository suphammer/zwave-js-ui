import { describe, expect, it } from 'vitest'
import {
	getControllerType,
	setControllerType,
	getInclusionChannel,
	setInclusionChannel,
	validInclusionChannel,
} from './controllerOptions.js'

describe('controller settings', () => {
	it('defaults to Serial API without modifying saved settings', () => {
		const settings = { port: '/dev/zwave' }
		expect(getControllerType(settings)).toBe('serial-api')
		expect(getInclusionChannel(settings)).toBe('')
		expect(settings).toEqual({ port: '/dev/zwave' })
	})

	it('stores native choices in the existing Driver options', () => {
		const settings: any = { options: { logConfig: { enabled: true } } }
		setControllerType(settings, 'suphacap')
		setInclusionChannel(settings, '1')
		expect(settings.options).toEqual({
			logConfig: { enabled: true },
			controller: { type: 'suphacap', inclusionChannel: 1 },
		})
		expect(getControllerType(settings)).toBe('suphacap')
		expect(getInclusionChannel(settings)).toBe(1)
		setInclusionChannel(settings, '')
		expect(settings.options.controller).toEqual({ type: 'suphacap' })
	})

	it('preserves existing native options until the controller type changes', () => {
		const settings: any = {
			options: {
				controller: {
					type: 'suphacap',
					inclusionChannel: 1,
					homeId: 0xc1234567,
				},
			},
		}
		setControllerType(settings, 'suphacap')
		expect(settings.options.controller.homeId).toBe(0xc1234567)
		setControllerType(settings, 'serial-api')
		setInclusionChannel(settings, '2')
		expect(settings.options.controller).toEqual({ type: 'serial-api' })
	})

	it.each(['', null, undefined, 0, 1, '2', 255])(
		'accepts an optional logical inclusion channel %j',
		(value) => expect(validInclusionChannel(value)).toBe(true),
	)

	it.each([-1, 256, 1.5, 'invalid', ' ', true, NaN, Infinity])(
		'rejects an invalid logical inclusion channel %j',
		(value) => expect(validInclusionChannel(value)).toMatch(/0 and 255/),
	)
})
