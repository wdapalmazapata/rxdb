const { getDatabase } = require('./shared');
const renderTest = require('./test/render.test.js');
const electron = require('electron');
const { getRxStorageMemory } = require('rxdb/plugins/storage-memory');
const { getRxStorageIpcRenderer } = require('../../plugins/electron');


const { replicateNats } = require('rxdb/plugins/replication-nats');  // REPL
const { filter } = require('rxjs/operators');
const heroesList = document.querySelector('#heroes-list');
const messageArea = document.querySelector('#message-area')

async function run() {
    /**
     * to check if rxdb works correctly, we run some integration-tests here
     * if you want to use this electron-example as boilerplate, remove this line
     */
    await renderTest();

    const dbSuffix = await window.getDBSuffix();


    const storage = getRxStorageIpcRenderer({
        key: 'main-storage',
        statics: getRxStorageMemory().statics,
        ipcRenderer: electron.ipcRenderer
    });

    console.log('GET DATABASE');
    const db = await getDatabase(
        'heroesdb' + dbSuffix, // we add a random timestamp in dev-mode to reset the database on each start
        storage
    );
    console.log('GET DATABASE DONE');

    // To start the replication, call replicateNats() from plugin with the collection that must be replicated.
    // The replication runs per RxCollection
    // https://rxdb.info/replication-nats.html
    console.log('REPLICATION START');
    const replicationState = replicateNats({
        collection: db.heroes,
        replicationIdentifier: 'my-nats-replication-collection-A',
        // in NATS, each stream need a name
        streamName: 'stream-for-replication-A',
        /**
         * The subject prefix determines how the documents are stored in NATS.
         * For example the document with id 'alice' will have the subject 'foobar.alice'
         */
        subjectPrefix: 'heroes',
        connection: { /* NATS Client Connection Settings */
            servers: 'localhost:4222',
            verbose: true,
            waitOnFirstConnect: true,
            maxReconnectAttempts: -1,
        },
        live: true,
        pull: {
            batchSize: 30
        },
        push: {
            batchSize: 30
        }
    });

    // await replicationState.awaitInitialReplication()
    // replicationState.awaitInitialReplication().then(() => {
    //     console.log("initialreplication complete:");
    // }).catch(err => {
    //     console.error("initialreplication error:", err)
    // });

    // show replication-errors in logs
    // heroesList.innerHTML = 'Subscribe to errors..';
    replicationState.error$.subscribe(err => {
        let natsErrorCode = undefined
        console.error('replication error:', err.name, err.code);
        if (err.parameters.errors) {
            err.parameters.errors.forEach(error => {
                console.log('replication error:', error.name, error.code);
                messageArea.innerHTML += '<p>replication error:' + error.name + ' ' + error.code + '<p>';
                if (error.name == "NatsError") {
                    natsErrorCode = error.code
                }
            });
        }
    });

    // emits each document that was received from the remote
    replicationState.received$.subscribe(doc => {
        console.log('document received from remote:', doc)
    });

    // emits each document that was send to the remote
    replicationState.sent$.subscribe(doc => {
        console.log('repl state: document sent:', doc)
    });

    // emits true when the replication was canceled, false when not.
    replicationState.canceled$.subscribe(bool => {
        if (bool) {
            console.error("repl state canceled!!!");
        } else {
            console.log("repl state not cancelled");
        }
    });

    // emits true when a replication cycle is running, false when not.
    replicationState.active$.subscribe(active => {
        const html = document.querySelector('#replication-state');
        if (active) {
            html.color = "green";
            html.innerHTML = "Cycle is running"
        } else {
            html.color = "gray";
            html.innerHTML = "Cycle is not running"
        }
        console.log("repl state active:", active)
    });

    // log all collection events for debugging
    db.heroes.$.pipe(filter(ev => !ev.isLocal)).subscribe(ev => {
        console.log('heroes.$ emitted:', ev.documentData);
    });

    /**
     * map the result of the find-query to the heroes-list in the dom
     */
    db.heroes.find()
        .sort({
            name: 'asc'
        })
        .$.subscribe(function (heroes) {
            if (!heroes) {
                heroesList.innerHTML = 'Loading..';
                return;
            }
            console.log('observable fired');
            console.dir(heroes);

            heroesList.innerHTML = heroes
                .map(hero => {
                    return '<li>' +
                        '<div class="color-box" style="background:' + hero.color + '"></div>' +
                        '<div class="name" name="' + hero.name + '">' + hero.name + '</div>' +
                        '</li>';
                })
                .reduce((pre, cur) => pre += cur, '');
        });

    window.addHero = async function () {
        const name = document.querySelector('input[name="name"]').value;
        const color = document.querySelector('input[name="color"]').value;
        const obj = {
            name: name,
            color: color
        };
        console.log('inserting hero:');
        console.dir(obj);
        await db.heroes.insert(obj);
        console.log('inserting hero DONE');
    };
}
run();
