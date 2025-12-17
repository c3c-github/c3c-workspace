exports.renderHome = (req, res) => {
    res.render('home', { 
        user: req.session.user,
        page: 'home' // Marca o menu lateral como Home
    });
};

exports.renderApprovals = (req, res) => {
    res.render('approvals', { 
        user: req.session.user,
        page: 'approvals' // Marca o menu lateral como Aprovações
    });
};