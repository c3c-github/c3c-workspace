require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("📅 Cadastrando feriados nacionais 2026 no Salesforce...");

    const holidays = [
        { Name: 'Confraternização Universal', ActivityDate: '2026-01-01' },
        { Name: 'Carnaval', ActivityDate: '2026-02-16' },
        { Name: 'Carnaval', ActivityDate: '2026-02-17' },
        { Name: 'Quarta-feira de Cinzas', ActivityDate: '2026-02-18' },
        { Name: 'Sexta-feira Santa', ActivityDate: '2026-04-03' },
        { Name: 'Tiradentes', ActivityDate: '2026-04-21' },
        { Name: 'Dia do Trabalho', ActivityDate: '2026-05-01' },
        { Name: 'Corpus Christi', ActivityDate: '2026-06-04' },
        { Name: 'Independência do Brasil', ActivityDate: '2026-09-07' },
        { Name: 'Nossa Senhora Aparecida', ActivityDate: '2026-10-12' },
        { Name: 'Finados', ActivityDate: '2026-11-02' },
        { Name: 'Proclamação da República', ActivityDate: '2026-11-15' },
        { Name: 'Consciência Negra', ActivityDate: '2026-11-20' },
        { Name: 'Natal', ActivityDate: '2026-12-25' }
    ];

    const toCreate = holidays.map(h => ({
        Name: h.Name,
        ActivityDate: h.ActivityDate,
        IsAllDay: true
    }));

    try {
        // Verifica se já existem para não duplicar
        const existing = await conn.query("SELECT ActivityDate FROM Holiday WHERE ActivityDate >= 2026-01-01");
        const existingDates = new Set(existing.records.map(r => r.ActivityDate));

        const filtered = toCreate.filter(h => !existingDates.has(h.ActivityDate));

        if (filtered.length === 0) {
            console.log("✅ Feriados já estão cadastrados.");
            return;
        }

        const ret = await conn.sobject('Holiday').create(filtered);
        const successCount = ret.filter(r => r.success).length;
        console.log(`✅ ${successCount} feriados cadastrados com sucesso!`);
    } catch (e) {
        console.error("❌ Erro ao cadastrar feriados:", e.message);
    }
}

run();
