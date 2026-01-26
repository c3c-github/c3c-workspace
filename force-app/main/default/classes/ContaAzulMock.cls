@isTest
public class ContaAzulMock implements HttpCalloutMock {
    public HttpResponse respond(HttpRequest req) {
        HttpResponse res = new HttpResponse();
        res.setHeader('Content-Type', 'application/json');
        res.setStatusCode(200);

        String endpoint = req.getEndpoint();

        if (endpoint.contains('oauth2/token')) {
            // Mock de Autenticação
            res.setBody('{"access_token": "mock_token", "refresh_token": "mock_refresh", "expires_in": 3600}');
        } else if (endpoint.contains('/parcelas')) {
            // Mock de Status da Parcela
            // Simula uma resposta de parcelas do Conta Azul
            res.setBody('[{"status": "QUITADO", "valor_pago": 1000.00}]');
        } else {
            res.setStatusCode(404);
        }

        return res;
    }
}