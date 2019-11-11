const axios = require('axios');
const ngrok = require('ngrok');
const express = require('express');
const parser = require('body-parser');
const fs = require('fs-extra');

const app = express();
app.use(parser.json());

const invoiceFile = require('./invoices.json');
const invoices = new Map(invoiceFile.map(i => [i.id, i]));

function getAccessToken(clientID, secretID) {
  return new Promise(async resolve => {
    axios({
      url: 'https://api.sandbox.paypal.com/v1/oauth2/token',
      method: 'post',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en_US',
        'content-type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: clientID,
        password: secretID,
      },
      params: {
        grant_type: 'client_credentials',
      },
    })
    .then(({ data }) => resolve(data.access_token))
    .catch(resolve);
  });
}

function createWebhook(token, url) {
  return new Promise(resolve => {
    axios({
      url: 'https://api.sandbox.paypal.com/v1/notifications/webhooks',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      data: {
        url: url,
        event_types: [{
          name: 'INVOICING.INVOICE.PAID'
        }]
      }
    })
      .then(({ data }) => resolve(data))
      .catch(e => console.log('Error', e));
  });
}

function simulateEvent(token, url, type) {
  return new Promise(resolve => {
    axios({
      method: 'POST',
      url: 'https://api.sandbox.paypal.com/v1/notifications/simulate-event',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      data: {
        url: url,
      	event_type: type,
      	resource_version: '1.0'
      }
    })
      .then(({ data }) => resolve(data))
      .catch(e => console.log('Error', e));
  });
}

function createInvoice(token, price, defaultEmail) {
  return new Promise(async resolve => {
    const { data: { href: paymentURL } } = await axios({
      url: 'https://api.sandbox.paypal.com/v2/invoicing/invoices',
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      data: {
        detail: {
          currency_code: 'USD'
        },
        primary_recipients: [
          {
            billing_info: {
              email_address: defaultEmail
            }
          }
        ],
        items: [
          {
            name: 'Online Payment',
            quantity: '1',
            unit_amount: {
              currency_code: 'USD',
              value: price
            }
          }
        ],
        note: 'Thank you for your business.',
        terms: 'No refunds.'
      }
    });

    const invoiceID = paymentURL.match(/\/([^\/]+)$/)[1];

    const { data: { href: invoiceURL } } = await axios({
      url: 'https://api.paypal.com/v2/invoicing/invoices/' + invoiceID + '/send',
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      data: {
        invoice_id: invoiceID
      }
    });

    const data = {
      id: invoiceID,
      key: 'value'
    };

    invoices.set(invoiceID, data);
    invoiceFile.push(data);
    await fs.writeFile('invoices.json', JSON.stringify(invoices, null, 2));

    resolve(invoiceURL);
  });
}

async function run() {
  console.log('Express server listening on port 3000.');

  // create ngrok tunnel
  const url = await ngrok.connect(3000);
  console.log('ngrok tunnel initiated at ' + url);

  // create access token
  const token = await getAccessToken('PAYPAL-CLIENT-ID', 'PAYPAL-SECRET');
  console.log('Access token: ' + token);

  // create webhook
  await createWebhook(token, url);

  // simulate payment - remove in prod
  await simulateEvent(token, url, 'INVOICING.INVOICE.PAID');
}

app.post('/', ({ body }, res) => {
  const wasCreatedHere = invoices.get(body.resource.id);
  if (!wasCreatedHere) return console.log('Received invoice but ID did not match cached IDs.');

  console.log('Invoice Paid', body);
});

app.listen(3000, run);
