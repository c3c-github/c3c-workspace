const fs = require('fs');
const { getSfConnection } = require('../config/salesforce');

exports.renderSignaturePage = (req, res) => {
    // Protocolo e host dinâmicos para URLs absolutas de imagens
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.render('utilities_signature', { 
        user: req.session.user, 
        page: 'utilities_signature',
        baseUrl: baseUrl
    });
};

exports.uploadPhoto = async (req, res) => {
    let tempPath = req.file ? req.file.path : null;
    try {
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        
        const conn = await getSfConnection();
        const userId = req.session.user.id;
        const fileContent = fs.readFileSync(tempPath).toString('base64');

        // 1. Criar ContentVersion (O arquivo no Salesforce)
        const cv = await conn.sobject('ContentVersion').create({
            Title: `Foto_Perfil_${userId}`,
            PathOnClient: req.file.originalname,
            VersionData: fileContent,
            IsMajorVersion: true
        });

        // 2. Buscar o ID do ContentDocument gerado
        const cvResult = await conn.sobject('ContentVersion').retrieve(cv.id);
        
        // 3. Criar ContentDistribution (Gera o link público)
        const cd = await conn.sobject('ContentDistribution').create({
            Name: `Public_Photo_${userId}`,
            ContentVersionId: cv.id,
            PreferencesAllowViewInBrowser: true,
            PreferencesLinkLatestVersion: true,
            PreferencesNotifyOnVisit: false,
            PreferencesPasswordRequired: false
        });

        // 4. Buscar a URL pública gerada (ContentDownloadUrl)
        const cdFull = await conn.query(`SELECT ContentDownloadUrl FROM ContentDistribution WHERE Id = '${cd.id}'`);
        const publicUrl = cdFull.records[0].ContentDownloadUrl;

        // 5. Salvar a URL no campo URL_Foto__c do objeto Pessoa__c
        await conn.sobject('Pessoa__c').update({
            Id: userId,
            URL_Foto__c: publicUrl
        });

        // 6. Atualizar a sessão do usuário com a nova foto
        req.session.user.foto = publicUrl;

        // Limpa arquivo temporário
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        res.json({ success: true, url: publicUrl });

    } catch (e) {
        console.error("❌ Erro no upload de foto:", e);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        res.status(500).json({ error: e.message });
    }
};