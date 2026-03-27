require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function runSyncV2() {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] 🚀 INICIANDO MOTOR DE SINCRONIZAÇÃO V2...`);

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

        // ---------------------------------------------------------
        // FASE 0: PRÉ-CARREGAMENTO
        // ---------------------------------------------------------
        const holidayRecords = await fetchAll("SELECT ActivityDate FROM Holiday");
        const holidaySet = new Set(holidayRecords.map(h => h.ActivityDate));

        // ---------------------------------------------------------
        // FASE 1: EQUALIZAÇÃO E LIMPEZA
        // ---------------------------------------------------------
        console.log('⏳ [1/4] Equalizando bases mensais e limpando duplicatas...');
        
        const [alocsComm, alocsExec, budgetRecords] = await Promise.all([
            fetchAll("SELECT Id, Servico__c, Produto__c, TaxaVenda__c, CustoEstimado__c, DataInicio__c, DataFim__c, PercentualAlocacao__c FROM AlocacaoPrevista__c"),
            fetchAll("SELECT Id, Servico__c, Pessoa__c, DataInicio__c, DataFimOriginal__c, Percentual__c, TaxaVenda__c, CustoHr__c FROM Alocacao__c"),
            fetchAll("SELECT Id, Alocacao__c, AlocacaoPrevista__c, Competencia__c, ReceitaPrevista__c, CustoPrevisto__c FROM OrcamentoCompetencia__c")
        ]);

        const orcMap = new Map();
        const toDelete = [];

        budgetRecords.forEach(o => {
            const ownerId = o.Alocacao__c || o.AlocacaoPrevista__c;
            const key = `${ownerId}_${o.Competencia__c}`;
            if (!ownerId) {
                toDelete.push(o.Id);
            } else if (orcMap.has(key)) {
                toDelete.push(o.Id); // Duplicate found
            } else {
                orcMap.set(key, o);
            }
        });

        if (toDelete.length > 0) {
            console.log(`🗑️  Removing ${toDelete.length} orphaned/duplicate budget records...`);
            await bulkOperation(conn, 'OrcamentoCompetencia__c', 'delete', toDelete.map(id => ({ Id: id })));
        }

        const toCreate = [], toUpdate = [];

        const processAloc = (aloc, isComm) => {
            if (!aloc.DataInicio__c) return;
            const endStr = isComm ? aloc.DataFim__c : aloc.DataFimOriginal__c;
            if (!endStr) return;

            const start = new Date(aloc.DataInicio__c + 'T12:00:00');
            const end = new Date(endStr + 'T12:00:00');
            
            let cur = new Date(start.getFullYear(), start.getMonth(), 1);
            const endLimit = new Date(end.getFullYear(), end.getMonth(), 1);

            while (cur <= endLimit) {
                const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
                const overlapStart = start > mStart ? start : mStart;
                const overlapEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0) < end ? new Date(cur.getFullYear(), cur.getMonth() + 1, 0) : end;

                const businessDays = countBusinessDays(overlapStart, overlapEnd, holidaySet);
                
                if (businessDays > 0) {
                    const compStr = mStart.toISOString().split('T')[0];
                    const key = `${aloc.Id}_${compStr}`;
                    const percent = (isComm ? aloc.PercentualAlocacao__c : aloc.Percentual__c) || 100;
                    const hours = businessDays * 8 * (percent / 100);
                    const revPrev = hours * (aloc.TaxaVenda__c || 0);
                    const costPrev = hours * (isComm ? aloc.CustoEstimado__c : aloc.CustoHr__c || 0);

                    const existing = orcMap.get(key);
                    const record = {
                        Competencia__c: compStr,
                        ReceitaPrevista__c: parseFloat(revPrev.toFixed(2)),
                        CustoPrevisto__c: parseFloat(costPrev.toFixed(2)),
                        Servico__c: aloc.Servico__c
                    };

                    if (existing) {
                        if (Math.abs(existing.ReceitaPrevista__c - record.ReceitaPrevista__c) > 0.1 || Math.abs(existing.CustoPrevisto__c - record.CustoPrevisto__c) > 0.1) {
                            record.Id = existing.Id;
                            toUpdate.push(record);
                        }
                    } else {
                        if (isComm) record.AlocacaoPrevista__c = aloc.Id;
                        else record.Alocacao__c = aloc.Id;
                        toCreate.push(record);
                    }
                }
                cur.setMonth(cur.getMonth() + 1);
            }
        };

        alocsComm.forEach(a => processAloc(a, true));
        alocsExec.forEach(a => processAloc(a, false));

        if (toCreate.length > 0) { console.log(`📦 Creating ${toCreate.length} records...`); await bulkOperation(conn, 'OrcamentoCompetencia__c', 'create', toCreate); }
        if (toUpdate.length > 0) { console.log(`📦 Updating ${toUpdate.length} records...`); await bulkOperation(conn, 'OrcamentoCompetencia__c', 'update', toUpdate); }

        // ---------------------------------------------------------
        // FASE 2: RECONCILIAÇÃO
        // ---------------------------------------------------------
        console.log('⏳ [2/4] Reconciliando Realizado...');
        
        const [timeLogs, revenueLogs] = await Promise.all([
            fetchAll("SELECT Id, Responsavel__r.Alocacao__c, DiaPeriodo__r.Data__c, ValorTotalLancamento__c, Horas__c, Servico__c FROM LancamentoHora__c WHERE (Status__c = 'Faturado' OR Status__c = 'Aprovado') AND Responsavel__r.Alocacao__c != null"),
            fetchAll("SELECT OrcamentoCompetencia__c, ValorDistribuido__c FROM DistribuicaoReceita__c WHERE OrcamentoCompetencia__c != null")
        ]);

        const latestOrcs = await fetchAll("SELECT Id, Alocacao__c, AlocacaoPrevista__c, Competencia__c, CustoRealizado__c, ReceitaRealizada__c, HorasRealizadas__c FROM OrcamentoCompetencia__c");
        console.log(`📊 Loaded ${latestOrcs.length} budget records for reconciliation.`);

        const realizedMap = new Map();
        const alocCompToOrcId = new Map();

        latestOrcs.forEach(o => {
            realizedMap.set(o.Id, { cost: 0, revenue: 0, hours: 0, current: o });
            const ownerId = o.Alocacao__c || o.AlocacaoPrevista__c;
            const key = `${ownerId}_${o.Competencia__c}`;
            if (!alocCompToOrcId.has(key) || o.Alocacao__c) {
                alocCompToOrcId.set(key, o.Id);
            }
        });

        timeLogs.forEach(lh => {
            const alocId = lh.Responsavel__r.Alocacao__c;
            const comp = lh.DiaPeriodo__r.Data__c.substring(0, 7) + '-01';
            const key = `${alocId}_${comp}`;
            const orcId = alocCompToOrcId.get(key);
            
            if (orcId) {
                const data = realizedMap.get(orcId);
                data.cost += lh.ValorTotalLancamento__c || 0;
                data.hours += lh.Horas__c || 0;
            }
        });

        revenueLogs.forEach(rl => {
            const data = realizedMap.get(rl.OrcamentoCompetencia__c);
            if (data) data.revenue += rl.ValorDistribuido__c || 0;
        });

        const orcsUpdateFinal = [];
        for (const [id, val] of realizedMap.entries()) {
            const cost = parseFloat(val.cost.toFixed(2));
            const rev = parseFloat(val.revenue.toFixed(2));
            const hrs = parseFloat(val.hours.toFixed(2));
            
            const curr = val.current;
            // UPDATE ALL to force numeric values and fix existing nulls
            orcsUpdateFinal.push({ 
                Id: id, 
                CustoRealizado__c: cost, 
                ReceitaRealizada__c: rev, 
                HorasRealizadas__c: hrs 
            });
        }

        if (orcsUpdateFinal.length > 0) {
            console.log(`📦 Updating ${orcsUpdateFinal.length} budget records with realized data...`);
            await bulkOperation(conn, 'OrcamentoCompetencia__c', 'update', orcsUpdateFinal);
        }

        // ---------------------------------------------------------
        // FASE 3: CONSOLIDAÇÃO SERVIÇOS
        // ---------------------------------------------------------
        console.log('⏳ [3/4] Atualizando serviços...');
        const serviceTotals = await fetchAll(`SELECT Servico__c, SUM(ReceitaRealizada__c) r, SUM(CustoRealizado__c) c, SUM(ReceitaPrevista__c) rp, SUM(CustoPrevisto__c) cp FROM OrcamentoCompetencia__c GROUP BY Servico__c`);
        const svcsUpdate = serviceTotals.map(r => ({
            Id: r.Servico__c, ReceitaRealizada__c: r.r || 0, CustoRealizado__c: r.c || 0, MargemRealizada__c: (r.r || 0) > 0 ? (((r.r || 0) - (r.c || 0)) / (r.r || 0)) * 100 : 0,
            ReceitaPrevista__c: r.rp || 0, CustoPrevisto__c: r.cp || 0, MargemPrevista__c: (r.rp || 0) > 0 ? (((r.rp || 0) - (r.cp || 0)) / (r.rp || 0)) * 100 : 0
        }));
        if (svcsUpdate.length > 0) await bulkOperation(conn, 'Servico__c', 'update', svcsUpdate);

        console.log(`\n🏁 MOTOR FINALIZADO! Tempo: ${((new Date() - startTime) / 1000).toFixed(2)}s`);
    } catch (e) { console.error(`❌ ERRO:`, e.message); process.exit(1); }
}

function countBusinessDays(start, end, holidaySet) {
    let days = 0, cur = new Date(start);
    while (cur <= end) {
        const iso = cur.toISOString().split('T')[0];
        if (cur.getDay() !== 0 && cur.getDay() !== 6 && !holidaySet.has(iso)) days++;
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

async function bulkOperation(conn, object, operation, data) {
    const CHUNK = 100;
    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        if (operation === 'create') await conn.sobject(object).create(chunk);
        else if (operation === 'update') await conn.sobject(object).update(chunk);
        else if (operation === 'delete') await conn.sobject(object).destroy(chunk.map(r => r.Id));
    }
}

runSyncV2();
