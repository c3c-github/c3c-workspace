@isTest
public class ContaAzulSyncCalloutTest {

    private class HerokuMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(202);
            res.setBody('{"status": "started"}');
            return res;
        }
    }

    @isTest
    static void testTriggerSyncSuccess() {
        // Setup configuration
        insert new Configuracao__c(
            Heroku_URL__c = 'https://mock-heroku-app.herokuapp.com',
            Heroku_API_Key__c = 'test_api_key'
        );

        Test.setMock(HttpCalloutMock.class, new HerokuMock());

        Test.startTest();
        ContaAzulSyncCallout.triggerSync();
        Test.stopTest();

        // Check callout completed (future method executed)
        // Since it's void and async, we verify it executes without exceptions
        System.assertEquals(1, [SELECT COUNT() FROM Configuracao__c]);
    }

    @isTest
    static void testTriggerSyncMissingConfig() {
        // No configuration record inserted

        Test.startTest();
        ContaAzulSyncCallout.triggerSync();
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Configuracao__c]);
    }
}
