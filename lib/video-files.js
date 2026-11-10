const VIDEO_EXTENSION = /\.(?:mp4|mkv|mov|m4v)$/i;

function isVideoFile(fileName) {
    return typeof fileName === 'string' && VIDEO_EXTENSION.test(fileName);
}

module.exports = { isVideoFile };
