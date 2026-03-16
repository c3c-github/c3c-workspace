const { getSfConnection } = require('../src/config/salesforce');

async function conciliar() {
    const conn = await getSfConnection();
    
    // IDs identificados
    const pessoaIds = [
        'a14N5000009ZDEwIAO', // Andherson
        'a14N5000009ZlA9IAK', // Caio
        'a14N5000009ZGb0IAG'  // Taty
    ];

    // Expandido para pegar a quebra dos períodos que avançam em Março
    const dataInicio = '2026-02-01';
    const dataFim = '2026-03-10';

    console.log(`🚀 Iniciando conciliação (Fev/Mar 2026) para ${pessoaIds.length} pessoas...`);

    try {
        // 1. Busca todos os DiaPeriodoId que possuem lançamentos dessas pessoas no intervalo
        const queryLancamentos = `
            SELECT DiaPeriodo__c 
            FROM LancamentoHora__c 
            WHERE Pessoa__c IN ('${pessoaIds.join("','")}')
            AND DiaPeriodo__r.Data__c >= ${dataInicio} 
            AND DiaPeriodo__r.Data__c <= ${dataFim}
            AND DiaPeriodo__c != NULL
            GROUP BY DiaPeriodo__c
        `;
        const resLanc = await conn.query(queryLancamentos);
        const diaIds = resLanc.records.map(r => r.DiaPeriodo__c);

        if (diaIds.length === 0) {
            console.log("✅ Nenhum dia encontrado para conciliação.");
            return;
        }

        console.log(`📅 Encontrados ${diaIds.length} dias para recalcular.`);

        // 2. Para cada dia, recalcula os totais (Lote de 50 por vez)
        const totalDias = diaIds.length;
        let processados = 0;

        for (let i = 0; i < diaIds.length; i += 50) {
            const batch = diaIds.slice(i, i + 50);
            
            const soqlSoma = `
                SELECT DiaPeriodo__c, 
                       SUM(Horas__c) totalNormal, 
                       SUM(HorasExtras__c) totalExtra, 
                       SUM(HorasBanco__c) totalBanco,
                       SUM(HorasAusenciaRemunerada__c) totalAusRem,
                       SUM(HorasAusenciaNaoRemunerada__c) totalAusNaoRem
                FROM LancamentoHora__c 
                WHERE DiaPeriodo__c IN ('${batch.join("','")}')
                AND (Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)
                GROUP BY DiaPeriodo__c
            `;
            
            const resSoma = await conn.query(soqlSoma);
            const updates = resSoma.records.map(r => ({
                Id: r.DiaPeriodo__c,
                Hora__c: r.totalNormal || 0,
                HoraExtra__c: r.totalExtra || 0,
                HoraBanco__c: r.totalBanco || 0,
                HoraLicencaRemunerada__c: r.totalAusRem || 0,
                HoraLicencaNaoRemunerada__c: r.totalAusNaoRem || 0
            }));

            const idsComSoma = new Set(resSoma.records.map(r => r.DiaPeriodo__c));
            batch.forEach(id => {
                if (!idsComSoma.has(id)) {
                    updates.push({
                        Id: id,
                        Hora__c: 0,
                        HoraExtra__c: 0,
                        HoraBanco__c: 0,
                        HoraLicencaRemunerada__c: 0,
                        HoraLicencaNaoRemunerada__c: 0
                    });
                }
            });

            if (updates.length > 0) {
                const result = await conn.sobject('DiaPeriodo__c').update(updates);
                const successCount = result.filter(r => r.success).length;
                processados += successCount;
                console.log(`⏳ Processado: ${processados}/${totalDias} dias...`);
            }
        }

        console.log(`\n✨ Conciliação finalizada com sucesso!`);
        console.log(`📊 Total de registros de DiaPeriodo__c atualizados: ${processados}`);

    } catch (e) {
        console.error("❌ Erro durante a conciliação:", e.message);
    }
}

conciliar();