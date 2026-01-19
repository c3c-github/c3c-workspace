public with sharing class ContaAzulAuthService {

    private static final String TOKEN_ENDPOINT = 'https://auth.contaazul.com/oauth2/token';
    public class AuthException extends Exception {}

    // Wrapper para retornar o resultado da autenticação
    public class AuthResult {
        public String accessToken;
        public Configuracao__c configParaAtualizar;
    }

    /**
     * @description Obtém um token de acesso válido, seja do cache ou de um refresh.
     *              NÃO realiza DML, apenas retorna os dados para o chamador.
     * @return      AuthResult contendo o token e o registro de configuração modificado (se houver).
     */
    public static AuthResult getAuthentication() {
        List<Configuracao__c> configs = [SELECT Id, Name, Token__c, Refresh_Token__c, Data_Expiracao__c, ClientId__c, ClientSecret__c FROM Configuracao__c LIMIT 1];
        if (configs.isEmpty()) {
            throw new AuthException('Nenhum registro de Configuração de API foi encontrado.');
        }
        Configuracao__c config = configs[0];
        AuthResult result = new AuthResult();

        if (config.Data_Expiracao__c == null || config.Data_Expiracao__c <= Datetime.now().addMinutes(5)) {
            System.debug('Token expirado. Preparando para refresh...');
            ContaAzulTokenResponse tokenResponse = refreshAccessToken(config);
            
            config.Token__c = tokenResponse.access_token;
            if (String.isNotBlank(tokenResponse.refresh_token)) {
                config.Refresh_Token__c = tokenResponse.refresh_token;
            }
            config.Data_Expiracao__c = Datetime.now().addSeconds(tokenResponse.expires_in);
            
            result.accessToken = config.Token__c;
            result.configParaAtualizar = config; // Retorna o SObject modificado
        } else {
            System.debug('Utilizando token de acesso armazenado.');
            result.accessToken = config.Token__c;
            result.configParaAtualizar = null; // Nenhum DML necessário
        }
        System.debug('AuthService: Retornando token: ' + result.accessToken);
        return result;
    }

    /**
     * @description Realiza o callout para o endpoint de refresh token.
     *              NÃO realiza DML, apenas retorna a resposta da API.
     * @param  config O registro de configuração para obter as credenciais.
     * @return        ContaAzulTokenResponse com os novos dados do token.
     */
    @TestVisible
    private static ContaAzulTokenResponse refreshAccessToken(Configuracao__c config) {
        if (String.isBlank(config.ClientId__c) || String.isBlank(config.ClientSecret__c) || String.isBlank(config.Refresh_Token__c)) {
            throw new AuthException('ClientId, ClientSecret ou Refresh Token não estão configurados.');
        }

        String requestBody = 'grant_type=refresh_token&refresh_token=' + EncodingUtil.urlEncode(config.Refresh_Token__c, 'UTF-8');
        String authorizationHeader = 'Basic ' + EncodingUtil.base64Encode(Blob.valueOf(config.ClientId__c + ':' + config.ClientSecret__c));

        HttpRequest req = new HttpRequest();
        req.setEndpoint(TOKEN_ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Authorization', authorizationHeader);
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(requestBody);

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() == 200) {
            return (ContaAzulTokenResponse)JSON.deserialize(res.getBody(), ContaAzulTokenResponse.class);
        } else {
            throw new AuthException('Falha ao obter o refresh token. Status: ' + res.getStatusCode() + '. Resposta: ' + res.getBody());
        }
    }
}