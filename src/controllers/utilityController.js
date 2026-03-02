exports.renderSignaturePage = (req, res) => {
    // Protocolo e host dinâmicos para URLs absolutas de imagens
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.render('utilities_signature', { 
        user: req.session.user, 
        page: 'utilities_signature',
        baseUrl: baseUrl
    });
};