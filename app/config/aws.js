const AWS = require('aws-sdk');

/** Strip scheme and path from DO_SPACES_ENDPOINT (e.g. nyc3.digitaloceanspaces.com). */
function parseEndpointHost(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.replace(/^https?:\/\//i, '').split('/')[0].trim();
}

/**
 * Spaces API TLS cert covers {region}.digitaloceanspaces.com and *.{region}.digitaloceanspaces.com.
 * If DO_SPACES_ENDPOINT is mistakenly set to {bucket}.{region}.digitaloceanspaces.com, the SDK
 * can prepend the bucket again → cert error (e.g. dineos.dineos.sgp1.digitaloceanspaces.com).
 * Collapse any *.… .digitaloceanspaces.com host to the canonical 3-label API host.
 */
function normalizeSpacesEndpointHost(host) {
    if (!host) return '';
    const h = host.trim();
    const lower = h.toLowerCase();
    if (!lower.endsWith('.digitaloceanspaces.com')) {
        return h;
    }
    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 3) {
        return parts.join('.');
    }
    return parts.slice(-3).join('.');
}

const rawEndpointHost = parseEndpointHost(process.env.DO_SPACES_ENDPOINT || '');
const endpointHost = normalizeSpacesEndpointHost(rawEndpointHost);
const bucket = process.env.DO_SPACES_BUCKET || '';
const region =
    (process.env.DO_SPACES_REGION || '').trim() ||
    (endpointHost.split('.')[0] || 'us-east-1');

const rawCdn = (process.env.DO_SPACES_CDN_URL || '').trim();
const cdnBaseUrl = rawCdn.replace(/\/+$/, '');

const spacesEndpoint = endpointHost ? new AWS.Endpoint(endpointHost) : null;

const s3Config = {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
    region
};

if (spacesEndpoint) {
    s3Config.endpoint = spacesEndpoint;
}

const s3 = new AWS.S3(s3Config);

module.exports = {
    s3,
    bucket,
    region,
    cdnBaseUrl,
    endpointHost
};
