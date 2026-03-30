const { getSfConnection } = require('../config/salesforce');

exports.renderIndicatorsPage = async (req, res) => {
    res.render('service_indicators', { user: req.session.user, page: 'service_indicators' });
};

// 1. Endpoint para contar o total de registros no período
exports.getIndicatorCount = async (req, res) => {
    try {
        const { start, end, types, clients, services } = req.query;
        const conn = await getSfConnection();
        let where = `WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}`;
        
        if (types && types !== 'all') where += ` AND Servico__r.Tipo__c IN ('${types.split(',').join("','")}')`;
        if (clients && clients !== 'all') where += ` AND Servico__r.Conta__r.Name IN ('${clients.split(',').join("','")}')`;
        if (services && services !== 'all') where += ` AND Servico__r.Name IN ('${services.split(',').join("','")}')`;

        const result = await conn.query(`SELECT COUNT(Id) total FROM LancamentoHora__c ${where}`);
        res.json({ success: true, total: result.records[0].total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

// 2. Endpoint para buscar um chunk de dados (Keyset Pagination)
exports.getIndicatorChunk = async (req, res) => {
    try {
        const { start, end, types, clients, services, lastId, limit = 4000 } = req.query;
        const conn = await getSfConnection();
        
        let where = `WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}`;
        if (lastId) where += ` AND Id > '${lastId}'`;
        
        if (types && types !== 'all') where += ` AND Servico__r.Tipo__c IN ('${types.split(',').join("','")}')`;
        if (clients && clients !== 'all') where += ` AND Servico__r.Conta__r.Name IN ('${clients.split(',').join("','")}')`;
        if (services && services !== 'all') where += ` AND Servico__r.Name IN ('${services.split(',').join("','")}')`;

        const query = `
            SELECT Id, DiaPeriodo__r.Data__c, Pessoa__r.Name, Servico__r.Tipo__c, Servico__r.Name, 
                   Servico__r.Conta__r.Name, HorasCusto__c, ValorReceita__c, ValorTotalLancamento__c
            FROM LancamentoHora__c
            ${where}
            ORDER BY Id ASC
            LIMIT ${limit}
        `;
        
        const result = await conn.query(query);
        const data = result.records.map(r => ({
            id: r.Id,
            date: r.DiaPeriodo__r ? r.DiaPeriodo__r.Data__c : null,
            person: r.Pessoa__r ? r.Pessoa__r.Name : 'N/A',
            squad: (r.Servico__r ? r.Servico__r.Tipo__c : null) || 'Outros',
            service: r.Servico__r ? r.Servico__r.Name : 'N/A',
            client: (r.Servico__r && r.Servico__r.Conta__r) ? r.Servico__r.Conta__r.Name : 'N/A',
            hours: r.HorasCusto__c || 0,
            revenue: r.ValorReceita__c || 0,
            cost: r.ValorTotalLancamento__c || 0
        }));

        res.json({ success: true, data, lastId: data.length > 0 ? data[data.length - 1].id : null });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.getFilterOptions = async (req, res) => {
    try {
        const { start, end } = req.query;
        const conn = await getSfConnection();
        const query = `SELECT Servico__r.Tipo__c, Servico__r.Name, Servico__r.Conta__r.Name FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}`;
        
        const records = [];
        await new Promise((resolve, reject) => {
            conn.query(query).on("record", r => records.push(r)).on("end", () => resolve()).on("error", err => reject(err)).run({ autoFetch: true, maxFetch: 50000 });
        });
        
        const tSet = new Set(), cSet = new Set(), sSet = new Set();
        records.forEach(r => {
            if (r.Servico__r) {
                if (r.Servico__r.Tipo__c) tSet.add(r.Servico__r.Tipo__c);
                if (r.Servico__r.Name) sSet.add(r.Servico__r.Name);
                if (r.Servico__r.Conta__r && r.Servico__r.Conta__r.Name) cSet.add(r.Servico__r.Conta__r.Name);
            }
        });
        res.json({ success: true, filters: { types: Array.from(tSet).sort(), clients: Array.from(cSet).sort(), services: Array.from(sSet).sort() } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
