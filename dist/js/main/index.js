"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSchemas = void 0;
const assert = require("assert");
const Promise = require("bluebird");
const _ = require("lodash");
const dataTypeToDBTypeDialect = {
    postgres: (attr) => {
        if (attr.type.constructor.name === "STRING") {
            return `CHARACTER VARYING(${attr.type._length})`;
        }
        else if (attr.type.constructor.name === "BIGINT") {
            return 'BIGINT';
        }
        else if (attr.type.constructor.name === "INTEGER") {
            return 'INTEGER';
        }
        else if (attr.type.constructor.name === "DATE") {
            return 'TIMESTAMP WITH TIME ZONE';
        }
        else if (attr.type.constructor.name === "DATEONLY") {
            return 'DATE';
        }
        else {
            console.error(`${attr.field} is not support schema type.\n${JSON.stringify(attr.type)}`);
        }
    },
    mysql: (attr) => {
        if (attr.type.constructor.name === "STRING") {
            return `VARCHAR(${attr.type._length})`;
        }
        else if (attr.type.constructor.name.indexOf("TEXT") != -1) {
            if (Number.isNaN(Number.parseInt(attr.type._length))) {
                return (attr.type._length.toUpperCase() || "") + "TEXT";
            }
            else {
                return "TEXT";
            }
        }
        else if (attr.type.constructor.name === "TINYINT" || attr.type.constructor.name === "BIGINT" || attr.type.constructor.name === "INTEGER") {
            return `${attr.type.constructor.name === "INTEGER" ?
                "INT" : attr.type.constructor.name}${attr.type._length ? "(" + attr.type._length + ")" : ""}`
                + (attr.type._unsigned ? " UNSIGNED" : "");
        }
        else if (attr.type.constructor.name === "UUID") {
            return 'CHAR(36)';
        }
        else if (attr.type.constructor.name === "FLOAT") {
            return 'FLOAT';
        }
        else if (attr.type.constructor.name === "DECIMAL") {
            return `DECIMAL(${attr.type._precision},${attr.type._scale})` + (attr.type._unsigned ? " UNSIGNED" : "");
            ;
        }
        else if (attr.type.constructor.name === "BOOLEAN") {
            return 'TINYINT(1)';
        }
        else if (attr.type.constructor.name === "DATE") {
            return 'DATETIME';
        }
        else if (attr.type.constructor.name === "DATEONLY") {
            return 'DATE';
        }
        else if (attr.type.constructor.name === "ENUM") {
            return `ENUM('${attr.type.values.join("','")}')`;
        }
        else {
            console.error(`${attr.field} is not support schema type.\n${JSON.stringify(attr.type)} `);
        }
    }
};
exports.validateSchemas = (sequelize, options) => {
    options = _.clone(options) || {};
    options = _.defaults(options, { exclude: ['SequelizeMeta'] }, sequelize.options);
    const queryInterface = sequelize.getQueryInterface();
    const dataTypeToDBType = dataTypeToDBTypeDialect[sequelize.options.dialect];
    const checkAttributes = (queryInterface, tableName, model, options) => {
        return queryInterface.describeTable(tableName, options)
            .then(attributes => {
            return Promise.each(Object.keys(attributes), fieldName => {
                const attribute = attributes[fieldName];
                const modelAttr = model.rawAttributes[fieldName];
                assert(!_.isUndefined(modelAttr), `${tableName}.${fieldName} is not defined.\n${modelAttr}.\n${JSON.stringify(modelAttr, null, 2)}`);
                const dataType = dataTypeToDBType(modelAttr);
                assert(dataType === attribute.type, `${tableName}.${fieldName} field type is invalid.Model.${fieldName}.type[${dataType}] != Table.${fieldName}.type[${attribute.type}]`);
                assert(modelAttr.field === fieldName, `fieldName is not same.Model.field[${modelAttr.field}] != Table.primaryKey[${attribute.primaryKey}]`);
                assert(modelAttr.primaryKey === true === attribute.primaryKey === true, `illegal primaryKey defined ${tableName}.${fieldName}.Model.primaryKey[${modelAttr.primaryKey}] != Table.primaryKey[${fieldName}]`);
                assert((modelAttr.allowNull === true || _.isUndefined(modelAttr.allowNull)) === attribute.allowNull === true, `illegal allowNull defined ${tableName}.${fieldName}.Model.allowNull[${modelAttr.allowNull}] != Table.allowNull[${attribute.allowNull}]`);
                assert(modelAttr.comment === attribute.comment, `confusing comment defined ${tableName}.${fieldName}.Model.comment[${modelAttr.comment}] != Table.comment[${attribute.comment}]`);
            });
        });
    };
    const checkForeignKey = (queryInterface, tableName, model, options) => {
        return sequelize.query(queryInterface.QueryGenerator.getForeignKeysQuery(tableName), options)
            .then((foreignKeys) => {
            return Promise.each(foreignKeys, (fk) => {
                if (sequelize.options.dialect === 'mysql') {
                    return;
                }
                const modelAttr = model.rawAttributes[fk.from.split('\"').join('')];
                assert(!_.isUndefined(modelAttr.references), `${tableName}.[${modelAttr.field}] must be defined foreign key.\n${JSON.stringify(fk, null, 2)} `);
                assert(fk.to === modelAttr.references.key, `${tableName}.${modelAttr.field} => ${modelAttr.references.key} must be same to foreignKey[${fk.to}].\n${JSON.stringify(fk, null, 2)} `);
            });
        });
    };
    const checkIndexes = (queryInterface, tableName, model, options) => {
        return queryInterface
            .showIndex(tableName, options)
            .then((indexes) => {
            return Promise.each(indexes, index => {
                if (index.primary) {
                    index.fields.forEach(field => {
                        assert(!_.isUndefined(model.primaryKeys[field.attribute]), `${tableName}.${field.attribute} must be primaryKey`);
                    });
                }
                else {
                    const indexFields = _.map(index.fields, (field) => {
                        return field.attribute;
                    });
                    const modelIndex = _.find(model.options.indexes, (modelIndex) => {
                        return _.isEqual(modelIndex.fields, indexFields);
                    });
                    if (indexFields.length > 1) {
                        assert(!_.isUndefined(modelIndex), `${tableName}.[${indexFields}] must be defined combination key\n${JSON.stringify(index, null, 2)} `);
                    }
                    if (modelIndex) {
                        assert(modelIndex.unique === true === index.unique === true, `${tableName}.[${indexFields}] must be same unique value\n${JSON.stringify(index, null, 2)} `);
                    }
                    else if (model.rawAttributes[indexFields[0]] && model.rawAttributes[indexFields[0]].unique) {
                        if (typeof model.rawAttributes[indexFields[0]].unique === "boolean") {
                            assert(index.unique === true, `${tableName}.[${indexFields}] must be defined unique key\n${JSON.stringify(index, null, 2)} `);
                        }
                        else {
                            assert(index.unique === false, `${tableName}.[${indexFields}] must be defined unique key combined\n${JSON.stringify(index, null, 2)} `);
                        }
                    }
                    else if (model.rawAttributes[indexFields[0]] && model.rawAttributes[indexFields[0]].references) {
                        assert(sequelize.options.dialect === 'mysql', `${tableName}.[${indexFields}] is auto created index by mysql.\n${JSON.stringify(index, null, 2)} `);
                    }
                    else {
                        assert(false, `${tableName}.[${indexFields}] is not defined index.${JSON.stringify(index, null, 2)} `);
                    }
                }
            });
        });
    };
    return Promise.try(() => {
        return queryInterface
            .showAllTables(options)
            .then(tableNames => {
            return Promise
                .all(tableNames
                .filter(tableName => {
                return !_.includes(options.exclude, tableName);
            })
                .map(tableName => {
                return sequelize.model(tableName);
            })
                .map(model => {
                return checkAttributes(queryInterface, model.tableName, model, options)
                    .then(() => {
                    return checkForeignKey(queryInterface, model.tableName, model, options);
                })
                    .then(() => {
                    return checkIndexes(queryInterface, model.tableName, model, options);
                });
            }));
        });
    });
};
//# sourceMappingURL=index.js.map