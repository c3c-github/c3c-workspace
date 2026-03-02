require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("📂 Iniciando cadastro corrigido de feriados regionais...");

    const RT_ESTADUAL = '012N5000005w66zIAA';
    const RT_MUNICIPAL = '012N5000005w670IAA';

    const mesMapExtenso = {
        '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
        '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
        '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };

    // 1. Busca IDs de Estados e Municípios
    const estados = await conn.query("SELECT Id, Sigla__c FROM Estado__c");
    const estMap = {};
    estados.records.forEach(e => estMap[e.Sigla__c] = e.Id);

    const municipios = await conn.query("SELECT Id, Name, Estado__r.Sigla__c FROM Municipio__c");
    const munMap = {};
    municipios.records.forEach(m => {
        const key = `${m.Name}|${m.Estado__r.Sigla__c}`;
        munMap[key] = m.Id;
    });

    const feriados = [
        // ESTADUAIS
        { name: 'Revolução Constitucionalista', state: 'SP', date: '2026-07-09', rt: RT_ESTADUAL },
        { name: 'São Jorge', state: 'RJ', date: '2026-04-23', rt: RT_ESTADUAL },
        { name: 'Independência da Bahia', state: 'BA', date: '2026-07-02', rt: RT_ESTADUAL },
        { name: 'São José', state: 'CE', date: '2026-03-19', rt: RT_ESTADUAL },
        { name: 'Data Magna do Ceará', state: 'CE', date: '2026-03-25', rt: RT_ESTADUAL },
        { name: 'Data Magna de Pernambuco', state: 'PE', date: '2026-03-06', rt: RT_ESTADUAL },
        { name: 'Santa Catarina', state: 'SC', date: '2026-08-11', rt: RT_ESTADUAL },

        // MUNICIPAIS
        { name: 'Aniversário de São Paulo', city: 'São Paulo', state: 'SP', date: '2026-01-25', rt: RT_MUNICIPAL },
        { name: 'São Sebastião', city: 'Rio de Janeiro', state: 'RJ', date: '2026-01-20', rt: RT_MUNICIPAL },
        { name: 'Aniversário de Fortaleza', city: 'Fortaleza', state: 'CE', date: '2026-04-13', rt: RT_MUNICIPAL },
        { name: 'Nossa Sra. Assunção', city: 'Fortaleza', state: 'CE', date: '2026-08-15', rt: RT_MUNICIPAL },
        { name: 'São João', city: 'Salvador', state: 'BA', date: '2026-06-24', rt: RT_MUNICIPAL },
        { name: 'Nossa Sra. Conceição Praia', city: 'Salvador', state: 'BA', date: '2026-12-08', rt: RT_MUNICIPAL },
        { name: 'Aniversário de Ribeirão Preto', city: 'Ribeirão Preto', state: 'SP', date: '2026-06-19', rt: RT_MUNICIPAL },
        { name: 'São Sebastião', city: 'Ribeirão Preto', state: 'SP', date: '2026-01-20', rt: RT_MUNICIPAL },
        { name: 'Nossa Sra. Auxiliadora', city: 'Goiânia', state: 'GO', date: '2026-05-24', rt: RT_MUNICIPAL },
        { name: 'Aniversário de Goiânia', city: 'Goiânia', state: 'GO', date: '2026-10-24', rt: RT_MUNICIPAL },
        { name: 'Aniversário de Araraquara', city: 'Araraquara', state: 'SP', date: '2026-08-22', rt: RT_MUNICIPAL }
    ];

    const toCreate = feriados.map(f => {
        const parts = f.date.split('-');
        const dia = parseInt(parts[2]).toString(); // Remove zero à esquerda
        const mes = mesMapExtenso[parts[1]];

        const payload = {
            Name: f.name,
            RecordTypeId: f.rt,
            Dia__c: dia,
            Mes__c: mes
        };

        if (f.rt === RT_ESTADUAL) {
            payload.Estado__c = estMap[f.state];
        } else {
            const key = `${f.city}|${f.state}`;
            payload.Municipio__c = munMap[key];
            payload.Estado__c = estMap[f.state];
        }

        return payload;
    }).filter(p => (p.RecordTypeId === RT_ESTADUAL ? !!p.Estado__c : !!p.Municipio__c));

    try {
        let successCount = 0;
        for (const payload of toCreate) {
            const ret = await conn.sobject('FeriadoRegional__c').create(payload);
            if (ret.success) {
                successCount++;
                console.log(`✅ Cadastrado: ${payload.Name}`);
            } else {
                console.error(`❌ Erro em ${payload.Name}:`, ret.errors);
            }
        }
        console.log(`\n✅ Total: ${successCount}/${toCreate.length} feriados regionais cadastrados!`);
    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

run();