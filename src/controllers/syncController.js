const { fork } = require('child_process');
const path = require('path');

const SYNC_API_KEY = process.env.SYNC_API_KEY || 'default_secret_key';

exports.triggerSync = (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${SYNC_API_KEY}`) {
        console.error("[Heroku Trigger] Falha na autenticação da chamada de sincronismo.");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const isFull = req.query.mode === 'full';
    const args = isFull ? ['--full'] : [];

    console.log(`[Heroku Trigger] Disparando sincronização via HTTP Callout (Modo: ${isFull ? 'Completo' : 'Incremental'})...`);
    
    try {
        const child = fork(path.join(__dirname, '../../scripts/sync-ca-sales.js'), args, {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();

        return res.status(202).json({ 
            status: 'started', 
            message: 'Sincronização iniciada em segundo plano.',
            mode: isFull ? 'full' : 'incremental' 
        });
    } catch (e) {
        console.error("[Heroku Trigger] Erro ao iniciar processo filho de sincronismo:", e.message);
        return res.status(500).json({ error: e.message });
    }
};
