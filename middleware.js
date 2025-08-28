#!/usr/bin/env node

const http = require('http');
const url = require('url');
const { execSync } = require('child_process');

// --- Environment Variables ---
const {
    MIDDLEWARE_PORT,
    GRIST_PORT,
    GRIST_API_KEY,
    TEAM, // Grist organization/team site domain name
} = process.env;

const log = (level, message) => console.log(`[${level.toUpperCase()}] [middleware] ${message}`);

/**
 * Main request handler.
 * It intercepts session checks to add users to the org if needed,
 * and proxies all other requests directly to Grist.
 */
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname.endsWith('/api/session/access/active')) {
        log('info', `Intercepting session access check for: ${req.url}`);
        await handleSessionRequest(req, res);
    } else {
        // For all other requests, act as a transparent proxy.
        proxyToGrist(req, res);
    }
}

/**
 * Handles the /api/session/access/active call to check and add users.
 */
async function handleSessionRequest(req, res) {
    const options = {
        hostname: '127.0.0.1',
        port: GRIST_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
    };

    // Make the initial request to Grist to check the user's status.
    const proxyReq = http.request(options, (proxyRes) => {
        let body = [];
        proxyRes.on('data', chunk => body.push(chunk));
        proxyRes.on('end', async () => {
            const responseBuffer = Buffer.concat(body);
            let data;

            try {
                data = JSON.parse(responseBuffer.toString());
            } catch (e) {
                log('warn', 'Response from Grist is not valid JSON. Passing it through as-is.');
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(responseBuffer);
                return;
            }

            // Check if the user is authenticated but not in an organization.
            const needsToBeAdded = data?.user?.email && data.org === null && data.orgError;

            if (needsToBeAdded) {
                const email = data.user.email;
                log('info', `User '${email}' has no active organization. Attempting to add to '${TEAM}'.`);
                const userWasAdded = await addUserToGristOrg(email);

                if (userWasAdded) {
                    log('info', `Successfully added '${email}'. Re-proxying the request to get the new session.`);
                    // If the user was added, we re-issue the original request to Grist
                    // to get the new session details with organization access.
                    proxyToGrist(req, res);
                    return;
                }
                log('warn', `Failed to add '${email}' to the organization. Returning original 'access denied' response.`);
            }

            // If the user didn't need to be added, or if adding failed,
            // return the original response from Grist.
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(responseBuffer);
        });
    });

    proxyReq.on('error', (err) => {
        log('error', `Proxy error: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway: Could not connect to Grist service.');
    });

    req.pipe(proxyReq, { end: true });
}

/**
 * Adds a user to the specified Grist organization using the Grist API.
 * @param {string} email - The email of the user to add.
 * @returns {Promise<boolean>} - True if the user was added successfully, false otherwise.
 */
async function addUserToGristOrg(email) {
    try {
        const addUserUrl = `http://127.0.0.1:${GRIST_PORT}/api/orgs/${TEAM}/access`;
        const payload = JSON.stringify({
            delta: {
                users: { [email]:'editors'}
            }
        });

        const addUserCmd = `curl -s -X PATCH \
            -H "Authorization: Bearer ${GRIST_API_KEY}" \
            -H "Content-Type: application/json" \
            -d '${payload}' \
            "${addUserUrl}"`;

        log('info', `Executing command to add user '${email}' to orgId ${TEAM}.`);
        execSync(addUserCmd, { encoding: 'utf-8', stdio: 'pipe' });

        log('info', `Successfully added user '${email}' to organization '${TEAM}'.`);
        return true;
    } catch (error) {
        log('error', `Failed to add user '${email}' to organization '${TEAM}': ${error.stack}`);
        if (error.stderr) {
            log('error', `Stderr from command: ${error.stderr}`);
        }
        return false;
    }
}

/**
 * Forwards the incoming request to the Grist service.
 */
function proxyToGrist(req, res) {
    const options = {
        hostname: '127.0.0.1',
        port: GRIST_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        log('error', `Proxy error: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway: Could not connect to Grist service.');
    });

    req.pipe(proxyReq, { end: true });
}

// --- Server Startup ---
if ([MIDDLEWARE_PORT, GRIST_PORT, GRIST_API_KEY, TEAM].some(v => !v)) {
    log('error', 'Missing one or more required environment variables (MIDDLEWARE_PORT, GRIST_PORT, GRIST_API_KEY, TEAM). Middleware shutting down.');
    process.exit(1);
}

http.createServer(handleRequest).listen(MIDDLEWARE_PORT, () => {
    log('info', `Server listening on port ${MIDDLEWARE_PORT}, proxying to Grist on port ${GRIST_PORT}.`);
});