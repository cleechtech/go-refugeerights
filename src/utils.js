var Q = require('q');
var moment = require('moment');
var vumigo = require('vumigo_v02');
var HttpApi = vumigo.http.api.HttpApi;

// Shared utils lib
go.utils = {

    timed_out: function(im) {
        var no_redirects = ['state_language', 'state_migrant_main', 'state_refugee_main'];
        return im.msg.session_event === 'new'
            && im.user.state.name
            && no_redirects.indexOf(im.user.state.name) === -1;
    },

    save_language: function(im, contact, lang) {
        var lang_map = {
            en: 'english',
            fr: 'french',
            am: 'amharic',
            sw: 'swahili',
            so: 'somali'
        };
        contact.extra.lang = lang;
        contact.extra.language = lang_map[lang];

        return Q.all([
            im.user.set_lang(lang),
            im.contacts.save(contact)
        ]);
    },

    set_language: function(im, contact) {
        if (contact.extra.lang !== undefined) {
            return im.user.set_lang(contact.extra.lang);
        } else {
            return Q();
        }
    },

    register_user: function(contact, im, status) {
        contact.extra.status = status;
        var country = contact.extra.country;

        return Q.all([
            im.contacts.save(contact),
            im.metrics.fire.inc(['total', 'registrations', 'last'].join('.')),
            im.metrics.fire.sum(['total', 'registrations', 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'registrations', status, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'registrations', status, 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'registrations', country, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'registrations', country, 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'registrations', status, country, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'registrations', status, country, 'sum'].join('.'), 1)
        ]);
    },

    track_redials: function(contact, im, decision) {
        var status = contact.extra.status || 'unregistered';
        return Q.all([
            im.metrics.fire.inc(['total', 'redials', 'choice_made', 'last'].join('.')),
            im.metrics.fire.sum(['total', 'redials', 'choice_made', 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'redials', status, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'redials', status, 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'redials', decision, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'redials', decision, 'sum'].join('.'), 1),
            im.metrics.fire.inc(['total', 'redials', status, decision, 'last'].join('.')),
            im.metrics.fire.sum(['total', 'redials', status, decision, 'sum'].join('.'), 1),
        ]);
    },

    get_clean_first_word: function(user_message) {
        return user_message
            .split(" ")[0]          // split off first word
            .replace(/\W/g, '')     // remove non letters
            .toUpperCase();         // capitalise
    },

    control_api_call: function (method, params, payload, endpoint, im) {
        var http = new HttpApi(im, {
            headers: {
                'Content-Type': ['application/json'],
                'Authorization': ['ApiKey ' + im.config.control.username + ':' + im.config.control.api_key]
            }
        });
        switch (method) {
            case "post":
                return http.post(im.config.control.url + endpoint, {
                    data: JSON.stringify(payload)
                });
            case "get":
                return http.get(im.config.control.url + endpoint, {
                    params: params
                });
            case "patch":
                return http.patch(im.config.control.url + endpoint, {
                    data: JSON.stringify(payload)
                });
            case "put":
                return http.put(im.config.control.url + endpoint, {
                    params: params,
                  data: JSON.stringify(payload)
                });
            case "delete":
                return http.delete(im.config.control.url + endpoint);
            }
    },

    subscription_unsubscribe_all: function(contact, im) {
        var params = {
            to_addr: contact.msisdn
        };
        return go.utils
        .control_api_call("get", params, null, 'subscription/', im)
        .then(function(json_result) {
            // make all subscriptions inactive
            var update = JSON.parse(json_result.data);
            var clean = true;  // clean tracks if api call is unnecessary
            for (i=0; i<update.objects.length; i++) {
                if (update.objects[i].active === true) {
                    update.objects[i].active = false;
                    clean = false;
                }
            }
            if (!clean) {
                return go.utils.control_api_call("patch", {}, update, 'subscription/', im);
            } else {
                return Q();
            }
        });
    },

    opt_out: function(im, contact) {
        contact.extra.optout_last_attempt = go.utils.get_today(im.config);

        return Q.all([
            im.contacts.save(contact),
            go.utils.subscription_unsubscribe_all(contact, im),
            im.api_request('optout.optout', {
                address_type: "msisdn",
                address_value: contact.msisdn,
                message_id: im.msg.message_id
            })
        ]);
    },

    opt_in: function(im, contact) {
        contact.extra.optin_last_attempt = go.utils.get_today(im.config);
        return Q.all([
            im.contacts.save(contact),
            im.api_request('optout.cancel_optout', {
                address_type: "msisdn",
                address_value: contact.msisdn
            }),
        ]);
    },

    get_today: function(config) {
        var today;
        if (config.testing_today) {
            today = new moment(config.testing_today);
        } else {
            today = new moment();
        }
        return today.format('YYYY-MM-DD hh:mm:ss.SSS');
    },

    "commas": "commas"
};