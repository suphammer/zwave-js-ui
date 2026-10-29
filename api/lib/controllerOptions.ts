import { ZWaveError, ZWaveErrorCodes } from '@zwave-js/core'
import type { PartialZWaveOptions } from 'zwave-js'

const nativeDisabledFeatures = [
	'softReset',
	'unresponsiveControllerRecovery',
	'watchdog',
] as const

function invalidControllerOptions(message: string): never {
	throw new ZWaveError(message, ZWaveErrorCodes.Driver_InvalidOptions)
}

export function applyControllerOptions(
	options: PartialZWaveOptions,
	explicitOptions: PartialZWaveOptions = {},
): void {
	const controller = options.controller
	if (controller === undefined) return
	if (
		controller === null ||
		typeof controller !== 'object' ||
		Array.isArray(controller) ||
		(controller.type !== 'serial-api' && controller.type !== 'suphacap')
	) {
		invalidControllerOptions(
			"Controller type must be 'serial-api' or 'suphacap'",
		)
	}
	if (controller.type === 'serial-api') return

	if (
		explicitOptions.features !== undefined &&
		(explicitOptions.features === null ||
			typeof explicitOptions.features !== 'object' ||
			Array.isArray(explicitOptions.features))
	) {
		invalidControllerOptions('options.features must be an object')
	}
	for (const feature of nativeDisabledFeatures) {
		const value = explicitOptions.features?.[feature]
		if (value !== undefined && value !== false) {
			invalidControllerOptions(
				`Suphacap does not support options.features.${feature}; remove it or set it to false`,
			)
		}
	}

	if (
		explicitOptions.rf?.txPower !== undefined ||
		explicitOptions.rf?.maxLongRangePowerlevel !== undefined
	) {
		invalidControllerOptions(
			'Suphacap does not support Serial API power calibration or Long Range power options',
		)
	}

	// The UI's Serial API defaults must not enable firmware features that a
	// native controller cannot perform. Keep unrelated Driver options intact.
	options.features = {
		...options.features,
		softReset: false,
		unresponsiveControllerRecovery: false,
		watchdog: false,
	}

	if (options.rf) {
		options.rf = { ...options.rf }
		delete options.rf.txPower
		delete options.rf.maxLongRangePowerlevel
	}
}
