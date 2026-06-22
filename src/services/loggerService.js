const { getSfConnection } = require('../config/salesforce');

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

class IntegrationLogger {
    constructor(scriptName) {
        this.scriptName = scriptName;
        this.logId = null;
        this.buffer = [];
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] ${message}`;
        originalConsoleLog(formatted);
        this.buffer.push(formatted);
    }

    error(message, err) {
        const timestamp = new Date().toISOString();
        const errMessage = err ? (err.stack || err.message || err) : '';
        const formatted = `[${timestamp}] ❌ ERROR: ${message}\n${errMessage}`;
        originalConsoleError(formatted);
        this.buffer.push(formatted);
    }

    interceptConsole() {
        console.log = (...args) => {
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
            this.log(msg);
        };
        console.error = (...args) => {
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
            this.error(msg);
        };
    }

    async start() {
        this.log("Iniciando execução do script...");
        try {
            const conn = await getSfConnection();
            const result = await conn.sobject("LogSincronismo__c").create({
                Script__c: this.scriptName,
                Data_Inicio__c: new Date().toISOString(),
                Status__c: 'Executando',
                Detalhes__c: this.buffer.join('\n')
            });
            if (result.success) {
                this.logId = result.id;
            }
        } catch (e) {
            console.error("⚠️ Falha ao criar registro de LogSincronismo__c no Salesforce:", e.message);
        }
    }

    async success(summaryMessage = "Sincronização concluída com sucesso.") {
        this.log(summaryMessage);
        await this.finalize('Sucesso');
        await this.cleanupOldLogs();
    }

    async fail(err) {
        const errMsg = err ? (err.message || err.toString()) : "Erro desconhecido";
        this.error("Falha na execução do script", err);
        await this.finalize('Erro', errMsg);
        await this.cleanupOldLogs();
    }

    async finalize(status, errorMessage = null) {
        if (!this.logId) return;
        try {
            const conn = await getSfConnection();
            await conn.sobject("LogSincronismo__c").update({
                Id: this.logId,
                Data_Fim__c: new Date().toISOString(),
                Status__c: status,
                Mensagem_Erro__c: errorMessage,
                Detalhes__c: this.buffer.join('\n').substring(0, 131072) // Limite do campo
            });
            
            // Também atualizar o status simplificado na Configuracao__c (para compatibilidade com o Flow existente)
            const configRes = await conn.query("SELECT Id FROM Configuracao__c LIMIT 1");
            if (configRes.totalSize > 0) {
                const configId = configRes.records[0].Id;
                const updates = {
                    Id: configId,
                    Status_Ultimo_Sincronismo__c: status,
                    Mensagem_Erro_Sincronismo__c: errorMessage
                };
                if (status === 'Sucesso') {
                    updates.Data_Ultimo_Sincronismo__c = new Date().toISOString();
                }
                await conn.sobject("Configuracao__c").update(updates);
            }
        } catch (e) {
            console.error("⚠️ Falha ao atualizar registro de LogSincronismo__c no Salesforce:", e.message);
        }
    }

    async cleanupOldLogs() {
        try {
            const conn = await getSfConnection();
            this.log("Limpando logs antigos (mais de 7 dias)...");
            const query = "SELECT Id FROM LogSincronismo__c WHERE CreatedDate < LAST_N_DAYS:7";
            const result = await conn.query(query).execute({ autoFetch: true });
            const records = Array.isArray(result) ? result : (result.records || []);
            
            if (records.length > 0) {
                this.log(`Encontrados ${records.length} logs antigos para exclusão.`);
                const ids = records.map(r => r.Id);
                
                const CHUNK = 200;
                for (let i = 0; i < ids.length; i += CHUNK) {
                    const chunk = ids.slice(i, i + CHUNK);
                    await conn.sobject("LogSincronismo__c").destroy(chunk);
                }
                this.log("Exclusão de logs antigos concluída.");
            } else {
                this.log("Nenhum log antigo para excluir.");
            }
        } catch (e) {
            this.error("Falha ao limpar logs antigos:", e);
        }
    }
}

module.exports = IntegrationLogger;
