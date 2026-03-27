require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function validateSync() {
    console.log("🔍 INICIANDO VALIDAÇÃO DE INTEGRIDADE (Competências vs Realizado)...");
    try {
        const conn = await getSfConnection();

        // Helper for robust chunked fetching
        const fetchAll = async (query) => {
            const records = [];
            await new Promise((resolve, reject) => {
                conn.query(query)
                    .on('record', (r) => records.push(r))
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .run({ autoFetch: true, maxFetch: 100000 });
            });
            return records;
        };

        // 1. Buscar Totais Realizados via LancamentoHora__c (Custos) e DistribuicaoReceita__c (Receitas)
        console.log("📊 Agregando dados de origem (Lancamentos e Distribuições)...");
        const [lhTotals, drTotals, orcTotals] = await Promise.all([
            fetchAll("SELECT Servico__c, SUM(ValorTotalLancamento__c) cost, SUM(Horas__c) hrs FROM LancamentoHora__c WHERE (Status__c = 'Faturado' OR Status__c = 'Aprovado') AND Responsavel__r.Alocacao__c != null GROUP BY Servico__c"),
            fetchAll("SELECT OrcamentoCompetencia__r.Servico__c svcId, SUM(ValorDistribuido__c) rev FROM DistribuicaoReceita__c GROUP BY OrcamentoCompetencia__r.Servico__c"),
            fetchAll("SELECT Servico__c, SUM(ReceitaRealizada__c) rev, SUM(CustoRealizado__c) cost, SUM(HorasRealizadas__c) hrs FROM OrcamentoCompetencia__c GROUP BY Servico__c")
        ]);

        const sourceMap = new Map();
        
        lhTotals.forEach(r => {
            if (!sourceMap.has(r.Servico__c)) sourceMap.set(r.Servico__c, { cost: 0, rev: 0, hrs: 0 });
            sourceMap.get(r.Servico__c).cost = r.cost || 0;
            sourceMap.get(r.Servico__c).hrs = r.hrs || 0;
        });

        drTotals.forEach(r => {
            if (!sourceMap.has(r.svcId)) sourceMap.set(r.svcId, { cost: 0, rev: 0, hrs: 0 });
            sourceMap.get(r.svcId).rev = r.rev || 0;
        });

        const orcMap = new Map();
        orcTotals.forEach(r => {
            orcMap.set(r.Servico__c, { cost: r.cost || 0, rev: r.rev || 0, hrs: r.hrs || 0 });
        });

        console.log(`\nVerificando ${sourceMap.size} serviços com movimentação...`);
        let errors = 0;
        let warnings = 0;

        for (const [svcId, source] of sourceMap) {
            const orc = orcMap.get(svcId);

            if (!orc) {
                console.error(`❌ ERRO: Serviço ${svcId} possui realizado mas NÃO possui registros em OrcamentoCompetencia__c.`);
                errors++;
                continue;
            }

            const costDiff = Math.abs(source.cost - orc.cost);
            const revDiff = Math.abs(source.rev - orc.rev);
            const hrsDiff = Math.abs(source.hrs - orc.hrs);

            if (costDiff > 0.1 || revDiff > 0.1 || hrsDiff > 0.1) {
                console.warn(`⚠️ DESVIO: Serviço ${svcId}`);
                console.warn(`   - Custo: Origem ${source.cost.toFixed(2)} vs Orcamento ${orc.cost.toFixed(2)} (Diff: ${costDiff.toFixed(2)})`);
                console.warn(`   - Receita: Origem ${source.rev.toFixed(2)} vs Orcamento ${orc.rev.toFixed(2)} (Diff: ${revDiff.toFixed(2)})`);
                console.warn(`   - Horas: Origem ${source.hrs.toFixed(2)} vs Orcamento ${orc.hrs.toFixed(2)} (Diff: ${hrsDiff.toFixed(2)})`);
                warnings++;
            }
        }

        console.log("\n--- RESULTADO DA VALIDAÇÃO ---");
        console.log(`✅ Serviços analisados: ${sourceMap.size}`);
        if (errors === 0 && warnings === 0) {
            console.log("✨ INTEGRIDADE TOTAL! Todos os valores batem.");
        } else {
            console.log(`❌ Erros críticos (Falta competência): ${errors}`);
            console.log(`⚠️ Avisos (Divergência de valores): ${warnings}`);
        }

    } catch (e) {
        console.error("❌ Falha na validação:", e.message);
    }
}

validateSync();
