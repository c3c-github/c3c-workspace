exports.renderSignaturePage = (req, res) => {
    res.render('utilities_signature', { 
        user: req.session.user, 
        page: 'utilities_signature' 
    });
};