function readObsPassword(environment = process.env) {
    if (!Object.prototype.hasOwnProperty.call(environment, 'OBS_PASSWORD_BASE64')) {
        return environment.OBS_PASSWORD;
    }

    const encoded = environment.OBS_PASSWORD_BASE64;
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.toString('base64') !== encoded) {
        throw new Error('OBS_PASSWORD_BASE64 ist kein gültiger Base64-Wert.');
    }
    return decoded.toString('utf8');
}

module.exports = { readObsPassword };
