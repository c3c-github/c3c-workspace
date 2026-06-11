require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const controller = require('../src/controllers/serviceIndicatorController');

async function simulateDashboardLoading() {
    console.log("🚀 SIMULANDO CARREGAMENTO DO DASHBOARD (API)...");
    
    const req = {
        query: {
            start: '2025-01-01',
            end: '2025-12-31',
            types: 'all',
            clients: 'all',
            services: 'all'
        }
    };

    let totalRevenue = 0;
    let totalRecords = 0;
    let lastId = null;
    let iteration = 1;
    let hasMore = true;
    let expectedTotal = 0;

    const mockRes = () => {
        let result = {};
        return {
            json: (data) => { result = data; return result; },
            status: function(code) { return this; },
            getResult: () => result
        };
    };

    try {
        // Simular contagem
        const resCount = mockRes();
        await controller.getIndicatorCount(req, resCount);
        expectedTotal = resCount.getResult().total;
        console.log(`📊 Total esperado (API Count): ${expectedTotal}`);

        while (hasMore) {
            console.log(`\n--- Iteração ${iteration} ---`);
            const chunkReq = { query: { ...req.query, lastId: lastId || '' } };
            const resChunk = mockRes();

            await controller.getIndicatorChunk(chunkReq, resChunk);
            const chunkData = resChunk.getResult();

            if (!chunkData || !chunkData.success || !chunkData.data || chunkData.data.length === 0) {
                console.log("🏁 Fim dos dados ou erro.");
                hasMore = false;
                break;
            }

            const chunkRevenue = chunkData.data.reduce((a, b) => a + b.revenue, 0);
            totalRevenue += chunkRevenue;
            totalRecords += chunkData.data.length;
            lastId = chunkData.lastId;

            console.log(`✅ Recebidos: ${chunkData.data.length} registros`);
            console.log(`💰 Receita no Chunk: R$ ${chunkRevenue.toLocaleString('pt-BR')}`);
            console.log(`📈 Acumulado: R$ ${totalRevenue.toLocaleString('pt-BR')}`);
            console.log(`🆔 Próximo lastId: ${lastId}`);

            if (lastId === 'VIRTUAL_DONE') {
                console.log("✨ Carregamento concluído com sucesso (VIRTUAL_DONE reached).");
                hasMore = false;
            }

            iteration++;
            if (iteration > 30) { // Aumentei o limite para suportar 18k+ registros
                console.log("⚠️ Muitas iterações, parando por segurança.");
                hasMore = false;
            }
        }

        console.log("\n--- RESULTADO FINAL DA SIMULAÇÃO ---");
        console.log(`Registros Totais: ${totalRecords} / ${expectedTotal}`);
        console.log(`Receita Final:    R$ ${totalRevenue.toLocaleString('pt-BR')}`);

    } catch (e) {
        console.error("❌ Erro na simulação:", e);
    }
}

simulateDashboardLoading();
