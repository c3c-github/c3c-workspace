public with sharing class ContaAzulSyncCallout {

    public class SyncException extends Exception {}

    @InvocableMethod(label='Disparar Sincronismo Heroku' description='Envia um sinal HTTP para o Heroku iniciar a sincronização completa das parcelas.')
    public static void triggerSync() {
        // Dispara de forma assíncrona em uma thread futura para não bloquear a execução do Flow
        makeCallout();
    }

    @future(callout=true)
    private static void makeCallout() {
        List<Configuracao__c> configs = [SELECT Heroku_URL__c, Heroku_API_Key__c FROM Configuracao__c LIMIT 1];
        if (configs.isEmpty()) {
            System.debug('⚠️ Erro ao disparar sincronismo: Nenhuma Configuração encontrada.');
            return;
        }

        Configuracao__c config = configs[0];
        if (String.isBlank(config.Heroku_URL__c) || String.isBlank(config.Heroku_API_Key__c)) {
            System.debug('⚠️ Erro ao disparar sincronismo: Heroku URL ou Heroku API Key não configurados.');
            return;
        }

        try {
            String url = config.Heroku_URL__c;
            if (!url.endsWith('/')) {
                url += '/';
            }
            url += 'api/sync/trigger?mode=full';

            Http http = new Http();
            HttpRequest req = new HttpRequest();
            req.setEndpoint(url);
            req.setMethod('POST');
            req.setHeader('Authorization', 'Bearer ' + config.Heroku_API_Key__c);
            req.setHeader('Content-Type', 'application/json');
            req.setBody('{}');

            HttpResponse res = http.send(req);
            System.debug('Heroku Sincronismo Status: ' + res.getStatusCode() + ' - ' + res.getBody());
        } catch (Exception e) {
            System.debug('❌ Falha ao realizar callout de sincronismo Heroku: ' + e.getMessage());
        }
    }
}
