export const controllerTypes = [
	{ title: 'Serial API', value: 'serial-api' },
	{ title: 'Suphacap RCP', value: 'suphacap' },
]

export function getControllerType(settings) {
	return settings.options?.controller?.type ?? 'serial-api'
}

export function setControllerType(settings, type) {
	if (!settings.options) settings.options = {}
	if (getControllerType(settings) === type) return
	settings.options.controller = { type }
}

export function getInclusionChannel(settings) {
	return settings.options?.controller?.inclusionChannel ?? ''
}

export function setInclusionChannel(settings, value) {
	if (getControllerType(settings) !== 'suphacap') return
	if (value === '' || value === null || value === undefined) {
		delete settings.options.controller.inclusionChannel
	} else {
		settings.options.controller.inclusionChannel = Number(value)
	}
}

export function validInclusionChannel(value) {
	return (
		value === '' ||
		value === null ||
		value === undefined ||
		((typeof value === 'number' ||
			(typeof value === 'string' && value.trim() !== '')) &&
			Number.isInteger(Number(value)) &&
			Number(value) >= 0 &&
			Number(value) <= 255) ||
		'Inclusion channel must be an integer between 0 and 255'
	)
}
