require('dotenv').config();
const { getSfConnection } = require('./src/config/salesforce');
const ejs = require('ejs');
const path = require('path');
const { calculateMargin } = require('./src/controllers/serviceController'); // Need to copy calculateMargin as it's not exported

const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : null;

const calculateMarginLocal = (rev, cost) => {
    if (rev > 0) return parseFloat((((rev - (cost || 0)) / rev) * 100).toFixed(2));
    if (cost > 0) return -100;
    return 0;
};

async function testRender() {
    try {
        const conn = await getSfConnection();
        const query = `
            SELECT Id, Name, Conta__r.Name, Tipo__c, Status__c, DataInicio__c, DataFimOriginal__c, DataFim__c, 
                   ReceitaVendida__c, CustoVendido__c, MargemVendida__c, 
                   ReceitaPrevista__c, CustoPrevisto__c, MargemPrevista__c, 
                   ReceitaRealizada__c, CustoRealizado__c, MargemRealizada__c,
                   (SELECT Id FROM VendasVinculadas__r LIMIT 1),
                   (SELECT Id FROM LancamentosHoras__r LIMIT 1)
            FROM Servico__c 
            ORDER BY Name ASC
        `;
        const result = await conn.query(query);
        const services = result.records.map(s => {
            const rev = s.ReceitaRealizada__c || 0;
            const cost = s.CustoRealizado__c || 0;
            const margem = calculateMarginLocal(rev, cost);

            return {
                id: s.Id, name: s.Name, client: s.Conta__r ? s.Conta__r.Name : '', type: s.Tipo__c, status: s.Status__c || 'Ativo',
                dataInicio: s.DataInicio__c, dataFimOriginal: s.DataFimOriginal__c, dataFim: s.DataFim__c,
                prop: { rev: s.ReceitaVendida__c || 0, margin: parseFloat((s.MargemVendida__c || 0).toFixed(2)) }, 
                act: { rev: rev, margin: margem }, 
                fcst: { rev: s.ReceitaPrevista__c || 0, cost: s.CustoPrevisto__c || 0, margin: parseFloat((s.MargemPrevista__c || 0).toFixed(2)) },
                health: {
                    hasSales: (s.VendasVinculadas__r && s.VendasVinculadas__r.totalSize > 0),
                    hasLogs: (s.LancamentosHoras__r && s.LancamentosHoras__r.totalSize > 0)
                }
            };
        });
        
        const templatePath = path.join(__dirname, 'views', 'services.ejs');
        ejs.renderFile(templatePath, { user: { nome: 'Test', grupos: ['GESTOR_FINANCEIRO'] }, page: 'services', services }, (err, str) => {
            if (err) {
                console.error("Render error:", err);
            } else {
                console.log("Render success!");
            }
        });
    } catch (e) {
        console.error("Overall error:", e);
    }
}

testRender();
