/* eslint-env worker */
/* eslint-disable no-restricted-globals */

import {
  Agent,
  Value,
  ManagedRealm,
  Type,
  CreateDataProperty,
  OrdinaryObjectCreate,
  AbruptCompletion,
  Throw,
  setSurroundingAgent,
  inspect,
  FEATURES,
} from '../../dist/engine262.mjs';

postMessage({ type: 'initialize', value: { FEATURES } });

addEventListener('message', ({ data }) => {
  console.log('@WORKER', data); // eslint-disable-line no-console

  if (data.type === 'evaluate') {
    const { state, code } = data.value;

    const agent = new Agent({
      features: [...state.get('features')],
      onDebugger() {
        debugger; // eslint-disable-line no-debugger
      },
    });
    setSurroundingAgent(agent);

    const promises = new Set();
    const realm = new ManagedRealm({
      promiseRejectionTracker(promise, operation) {
        switch (operation) {
          case 'reject':
            promises.add(promise);
            break;
          case 'handle':
            promises.delete(promise);
            break;
          default:
            break;
        }
      },
    });

    realm.scope(() => {
      const print = new Value((args) => {
        postMessage({
          type: 'console',
          value: {
            method: 'log',
            values: args.map((a) => inspect(a)),
          },
        });
        return Value.undefined;
      });
      CreateDataProperty(realm.GlobalObject, new Value('print'), print);

      {
        const console = OrdinaryObjectCreate(
          agent.intrinsic('%Object.prototype%'),
        );
        CreateDataProperty(realm.GlobalObject, new Value('console'), console);

        ['log', 'warn', 'debug', 'error', 'clear'].forEach((method) => {
          const fn = new Value((args) => {
            postMessage({
              type: 'console',
              value: {
                method,
                values: args.map((a, i) => {
                  if (i === 0 && Type(a) === 'String') {
                    return a.stringValue();
                  }
                  return inspect(a);
                }),
              },
            });
            return Value.undefined;
          });
          CreateDataProperty(console, new Value(method), fn);
        });
      }

      postMessage({
        type: 'console',
        value: {
          method: 'clear',
          values: [],
        },
      });

      let result;
      if (state.get('mode') === 'script') {
        result = realm.evaluateScript(code, { specifier: 'code.js' });
      } else {
        result = realm.createSourceTextModule('code.mjs', code);
        if (!(result instanceof AbruptCompletion)) {
          const module = result;
          realm.moduleEntry = module;
          result = module.Link();
          if (!(result instanceof AbruptCompletion)) {
            result = module.Evaluate();
            if (result.PromiseState === 'rejected') {
              result = Throw(result.PromiseResult);
            }
          }
        }
      }
      if (result instanceof AbruptCompletion) {
        postMessage({
          type: 'console',
          value: {
            method: 'error',
            values: [inspect(result)],
          },
        });
      }

      for (const promise of promises) {
        postMessage({
          type: 'unhandledRejection',
          // eslint-disable-next-line no-use-before-define
          value: inspect(promise.PromiseResult),
        });
      }
    });
  }
});
