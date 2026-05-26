export const uniqParamCounter = { current: 0 };

export function mergeDeep(...objects: any[]) {
  const isObject = (obj: any) => obj && typeof obj === 'object';

  return objects.reduce((prev: any, obj = {}) => {
    Object.keys(obj).forEach((key) => {
      const pVal = prev[key];
      const oVal = obj[key];

      if (Array.isArray(pVal) && Array.isArray(oVal)) {
        prev[key] = pVal.concat(...oVal);
      } else if (isObject(pVal) && isObject(oVal)) {
        prev[key] = mergeDeep(pVal, oVal);
      } else {
        prev[key] = oVal;
      }
    });

    return prev;
  }, {});
}

export function mergeDeepObjectsOnly(...objects: any[]) {
  const isObject = (obj: any) => obj && typeof obj === 'object';

  return objects.reduce((prev: any, obj = {}) => {
    Object.keys(obj).forEach((key) => {
      const pVal = prev[key];
      const oVal = obj[key];

      if (oVal === null) {
        delete prev[key];
      } else if (
        Array.isArray(oVal)
        || oVal instanceof Date
      ) {
        prev[key] = oVal;
      } else if (isObject(pVal) && isObject(oVal)) {
        prev[key] = mergeDeepObjectsOnly(pVal, oVal);
      } else {
        prev[key] = oVal;
      }
    });

    return prev;
  }, {});
}
