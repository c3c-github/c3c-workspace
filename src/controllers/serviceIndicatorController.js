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

        const result = await conn.query(`SELECT COUNT(Id) total FROM LancamentoHora__c ${where}`).execute();
        const records = Array.isArray(result) ? result : (result.records || []);
        let total = parseInt(records[0].total);

        // Somar estimativa de registros virtuais (um por parcela paga no período)
        const virtualCountRes = await conn.query(`SELECT COUNT(Id) total FROM ParcelaFinanceira__c WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end} AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')`).execute();
        const virtualRecords = Array.isArray(virtualCountRes) ? virtualCountRes : (virtualCountRes.records || []);
        total += parseInt(virtualRecords[0].total);

        res.json({ success: true, total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

// 2. Endpoint para buscar um chunk de dados (Keyset Pagination)
exports.getIndicatorChunk = async (req, res) => {
    try {
        const { start, end, types, clients, services, lastId, limit = 4000 } = req.query;
        const conn = await getSfConnection();
        const limitNum = parseInt(limit);
        
        if (lastId === 'VIRTUAL_DONE') return res.json({ success: true, data: [], lastId: 'VIRTUAL_DONE' });

        let data = [];
        let newLastId = lastId;

        // FASE 1: Carregar dados REAIS do Salesforce
        if (!lastId || !lastId.startsWith('VIRTUAL')) {
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
                LIMIT ${limitNum}
            `;
            
            const result = await conn.query(query).execute({ autoFetch: true, maxFetch: 100000 });
            const records = Array.isArray(result) ? result : (result.records || []);

            data = records.map(r => ({
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

            if (data.length > 0) {
                newLastId = data[data.length - 1].id;
            } else {
                newLastId = 'VIRTUAL_OFFSET_0';
            }
        }

        // FASE 2: Injetar Receita Direta (Virtual) - Lógica Granular por Parcela
        if (data.length < limitNum && (newLastId && (newLastId.startsWith('VIRTUAL') || data.length === 0)) && newLastId !== 'VIRTUAL_DONE') {
            const currentOffset = (!newLastId || !newLastId.startsWith('VIRTUAL')) ? 0 : parseInt(newLastId.split('_')[2]) || 0;

            // 1. Identificar VENDAS ativas
            const activeSalesRes = await conn.query(`
                SELECT Venda__c FROM VendaServico__c 
                WHERE Servico__c IN (
                    SELECT Servico__c FROM LancamentoHora__c 
                    WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}
                    AND ValorReceita__c > 0
                )
                GROUP BY Venda__c
            `).execute();
            const activeSalesRecords = Array.isArray(activeSalesRes) ? activeSalesRes : (activeSalesRes.records || []);
            const activeSalesIds = new Set(activeSalesRecords.map(r => r.Venda__c));

            // 2. Buscar TODAS as parcelas pagas no período
            const installmentsRes = await conn.query(`
                SELECT Id, Valor__c, DataVencimento__c, VendaContaAzul__c, 
                       VendaContaAzul__r.Name, VendaContaAzul__r.Cliente__c
                FROM ParcelaFinanceira__c 
                WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end}
                AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
            `).execute({ autoFetch: true });
            const installmentsRecords = Array.isArray(installmentsRes) ? installmentsRes : (installmentsRes.records || []);

            // 3. Buscar vínculos globais
            const linksRes = await conn.query(`
                SELECT Venda__c, Servico__c, Servico__r.Name, Servico__r.Tipo__c, 
                       Servico__r.Conta__r.Name, ValorAlocado__c, Venda__r.ValorTotal__c 
                FROM VendaServico__c
            `).execute({ autoFetch: true });
            const linksRecords = Array.isArray(linksRes) ? linksRes : (linksRes.records || []);
            
            const saleToLinks = new Map();
            linksRecords.forEach(l => {
                if (!saleToLinks.has(l.Venda__c)) saleToLinks.set(l.Venda__c, []);
                saleToLinks.get(l.Venda__c).push(l);
            });

            // 4. Construir lista granular de virtuais
            const allVirtual = [];
            
            installmentsRecords.forEach(p => {
                if (!activeSalesIds.has(p.VendaContaAzul__c)) {
                    const links = saleToLinks.get(p.VendaContaAzul__c) || [];
                    
                    if (links.length === 0) {
                        allVirtual.push({
                            id: 'VIRTUAL_' + p.Id,
                            date: p.DataVencimento__c,
                            person: '💰 RECEITA DIRETA',
                            squad: 'NÃO ASSOCIADO A SERVIÇO',
                            service: 'VENDA NÃO ASSOCIADA A SERVIÇO',
                            client: p.VendaContaAzul__r ? (p.VendaContaAzul__r.Cliente__c || p.VendaContaAzul__r.Name) : 'N/A',
                            hours: 0,
                            revenue: p.Valor__c || 0,
                            cost: 0
                        });
                    } else {
                        links.forEach(link => {
                            const ratio = (link.Venda__r && link.Venda__r.ValorTotal__c > 0) ? (link.ValorAlocado__c / link.Venda__r.ValorTotal__c) : (1 / links.length);
                            allVirtual.push({
                                id: 'VIRTUAL_' + p.Id + '_' + link.Servico__c,
                                date: p.DataVencimento__c,
                                person: '💰 RECEITA DIRETA',
                                squad: link.Servico__r ? link.Servico__r.Tipo__c : 'NÃO ASSOCIADO',
                                service: link.Servico__r ? link.Servico__r.Name : 'VENDA NÃO ASSOCIADA',
                                client: (link.Servico__r && link.Servico__r.Conta__r) ? link.Servico__r.Conta__r.Name : (p.VendaContaAzul__r ? (p.VendaContaAzul__r.Cliente__c || p.VendaContaAzul__r.Name) : 'N/A'),
                                hours: 0,
                                revenue: (p.Valor__c || 0) * ratio,
                                cost: 0
                            });
                        });
                    }
                }
            });

            // 5. Paginação (Chunking) do Virtual
            const needed = limitNum - data.length;
            const chunkVirtual = allVirtual.slice(currentOffset, currentOffset + needed);
            data.push(...chunkVirtual);

            if (currentOffset + needed >= allVirtual.length) {
                newLastId = 'VIRTUAL_DONE';
            } else {
                newLastId = `VIRTUAL_OFFSET_${currentOffset + needed}`;
            }
        }

        res.json({ success: true, data, lastId: newLastId });
    } catch (e) { 
        console.error("ERRO NO CHUNK:", e);
        res.status(500).json({ success: false, error: e.message }); 
    }
};

exports.getFilterOptions = async (req, res) => {
    try {
        const { start, end } = req.query;
        const conn = await getSfConnection();
        const query = `SELECT Servico__r.Tipo__c, Servico__r.Name, Servico__r.Conta__r.Name FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end}`;
        
        const result = await conn.query(query).execute({ autoFetch: true, maxFetch: 50000 });
        const records = Array.isArray(result) ? result : (result.records || []);
        
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
