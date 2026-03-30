const { getSfConnection } = require('../config/salesforce');

exports.renderIndicatorsPage = async (req, res) => {
    res.render('service_indicators', { 
        user: req.session.user, 
        page: 'service_indicators' 
    });
};

exports.getIndicatorData = async (req, res) => {
    try {
        const conn = await getSfConnection();
        
        // Query de Lançamentos (Fonte da Verdade)
        // Usando Horas__c como fallback se HorasCusto__c não for encontrado na execução
        const query = `
            SELECT 
                DiaPeriodo__r.Data__c date, 
                Pessoa__r.Name personName, 
                Servico__r.Tipo__c serviceType, 
                Servico__r.Name serviceName, 
                Servico__r.Conta__r.Name clientName, 
                Horas__c hours, 
                ValorReceita__c revenue, 
                ValorTotalLancamento__c cost
            FROM LancamentoHora__c
            WHERE DiaPeriodo__r.Data__c >= 2025-01-01
            ORDER BY DiaPeriodo__r.Data__c ASC
        `;
        
        const result = await conn.query(query);
        
        const data = result.records.map(r => ({
            date: r.date,
            person: r.personName,
            squad: r.serviceType || 'Outros',
            service: r.serviceName,
            client: r.clientName,
            hours: r.hours || 0,
            revenue: r.revenue || 0,
            cost: r.cost || 0
        }));

        res.json({ success: true, data });
    } catch (e) {
        console.error("Erro ao buscar indicadores:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};
