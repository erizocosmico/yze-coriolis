import { addDarknessPoints } from "./darkness-points.js";

export function coriolisModifierDialog(modifierCallback) {
    let value = 0;
    let d = new Dialog({
        title: game.i18n.localize("YZECORIOLIS.ModifierForRoll"),
        content: `<div class="yzecoriolis roll-modifier-dialog"><p>${game.i18n.localize("YZECORIOLIS.ModifierForRollQuestion")}</p> <input type="number" id="roll-modifier" min="-9" max="9" value="0" /></div>`,
        buttons: {
            ok: {
                label: 'Confirmar',
                callback: () => {
                    modifierCallback(value)
                }
            },
            cancel: {
                label: 'Cancelar',
                callback: () => {},
            },
        },
        default: "ok",
        render: html => {
            html.find('#roll-modifier').on('change', function (e) {
                let n = Number(this.value)
                if (!isNaN(n) && n < 10 && n > -10) {
                    value = n;
                }
            });
        },
        close: () => { }
    });
    d.render(true);
}
/**
 * takes in rendering options, rollData and:
 * 1. does the roll
 * 2. evaluates the roll
 * 3. takes the results and shows them in a chat message.
 * @param  {} chatOptions the options used to display the roll result in chat.
 * @param  {} rollData contains all data necessary to make a roll in Coriolis.
 */
export async function coriolisRoll(chatOptions, rollData) {
    let errorObj = { 'error': 'YZECORIOLIS.ErrorsInvalidSkillRoll' };
    const isValid = isValidRoll(rollData, errorObj);
    if (!isValid) {
        ui.notifications.error(new Error(game.i18n.localize(errorObj.error)));
        return;
    }

    let totalDice = getTotalDice(rollData);
    if (totalDice <= 0) {
        totalDice = 2; // desparation roll where both will have to be successes to be considered a success.
    }
    let roll = new Roll(`${totalDice}d6`);
    roll.roll();
    await showDiceSoNice(roll, chatOptions.rollMode);
    const result = evaluateCoriolisRoll(rollData, roll);
    await showChatMessage(chatOptions, result);
}
/**
 * handle pushing a roll
 * @param  {} msgOptions
 * @param  {} origRollData
 * @param  {} origRoll
 */
export async function coriolisPushRoll(msgOptions, origRollData, origRoll) {
    if (origRollData.pushed) {
        return;
    }
    origRollData.pushed = true;
    origRoll.dice.forEach(part => {
        part.results.forEach(r => {
            if (r.result !== CONFIG.YZECORIOLIS.maxRoll) {
                let newDie = new Die(6);
                newDie.roll(1);
                r.result = newDie.results[0].result;
            }
        })
    });
    await showDiceSoNice(origRoll, msgOptions.rollMode);
    const result = evaluateCoriolisRoll(origRollData, origRoll);
    await updateChatMessage(msgOptions, result);
    await addDarknessPoints(1);
}

/**
 *
 * returns if this is a valid Roll or not and an error describing why it isn't.
 * @param  {} rollData
 * @param  {} errorObj
 * @returns true / false
 */
function isValidRoll(rollData, errorObj) {
    // TODO: account for modifier somehow.
    // not as straight forward. should I apply modifiers before checking for zero?
    const skill = rollData.skill;
    const attribute = rollData.attribute;
    const bonus = rollData.bonus;
    switch (rollData.rollType) {
        case 'skill':
            return attribute + skill > 0;
        case 'weapon':
            return attribute + skill + bonus > 0;
        case 'armor':
            return bonus >= 0; // should probably always be true?
        case 'advancedSkill':
            if (skill <= 0) {
                errorObj.error = 'YZECORIOLIS.ErrorsInvalidAdvancedSkillRoll';
                return false;
            }
            return attribute + skill > 0;
        case 'attribute':
            return attribute > 0;
    }
    errorObj.error = 'YZECORIOLIS.ErrorsInvalidSkillRoll';
    return false;
}
/**
 * takes the result of the role and associated roll data and returns a result object.
 * @param  {rollType, skill, attribute, modifier} rollData
 * @param  {} roll
 * @returns {limitedSuccess,criticalSuccess,failure, roll, rollData} returns the results plus the initial rollData and roll object in case you wish to push.
 */
export function evaluateCoriolisRoll(rollData, roll) {
    let successes = 0;
    let maxRoll = CONFIG.YZECORIOLIS.maxRoll;
    roll.dice.forEach(part => {
        part.results.forEach(r => {
            if (r.result === maxRoll) {
                successes++;
            }
        })
    });
    const isDesparation = getTotalDice(rollData) <= 0;
    let result = {
        desparationRoll: isDesparation,
        successes: successes,
        limitedSuccess: isDesparation ? successes === 2 : (successes > 0 && successes < 3),
        criticalSuccess: successes >= 3,
        failure: isDesparation ? successes < 2 : successes === 0,
        rollData: rollData,
        roll: roll,
        pushed: rollData.pushed
    };

    return result;
}

function getTotalDice(rollData) {
    let attributeValue = rollData.attribute;
    let skillValue = rollData.skill;
    let modifier = rollData.modifier;
    let bonus = rollData.bonus;
    switch (rollData.rollType) {
        case 'skill':
            return attributeValue + skillValue + modifier;
        case 'advancedSkill':
            return attributeValue + skillValue + modifier;
        case 'attribute':
            return attributeValue + modifier;
        case 'weapon':
            return attributeValue + skillValue + bonus + modifier;
        case 'armor':
            return bonus + modifier;
    }
    return 0;
}

async function showChatMessage(chatMsgOptions, resultData) {
    let tooltip = await renderTemplate('systems/yzecoriolis/templates/sidebar/dice-results.html', getTooltipData(resultData));
    let chatData = {
        title: getRollTitle(resultData.rollData),
        results: resultData,
        tooltip: tooltip,
        canPush: !resultData.pushed
    };

    if (["gmroll", "blindroll"].includes(chatMsgOptions.rollMode)) chatMsgOptions["whisper"] = ChatMessage.getWhisperRecipients("GM");
    if (chatMsgOptions.rollMode === "blindroll") chatMsgOptions["blind"] = true;
    else if (chatMsgOptions.rollMode === "selfroll") chatMsgOptions["whisper"] = [game.user];

    chatMsgOptions["flags.data"] = {
        results: chatData.results
    };

    chatMsgOptions.roll = resultData.roll;
    return renderTemplate(chatMsgOptions.template, chatData).then(html => {
        chatMsgOptions['content'] = html;
        return ChatMessage.create(chatMsgOptions, false);
    });
}


async function updateChatMessage(msgOptions, resultData) {
    let tooltip = await renderTemplate('systems/yzecoriolis/templates/sidebar/dice-results.html', getTooltipData(resultData));
    let chatData = {
        title: getRollTitle(resultData.rollData),
        results: resultData,
        tooltip: tooltip,
        canPush: false
    };

    return renderTemplate('systems/yzecoriolis/templates/sidebar/roll.html', chatData).then(html => {
        msgOptions['content'] = html;
        return msgOptions.update({
            content: html,
            ["flags.data"]: { results: chatData.results }
        }).then(newMsg => {
            ui.chat.updateMessage(newMsg);
        });
    });
}

function getRollTitle(rollData) {
    return `${rollData.rollTitle}`;
}

function getTooltipData(results) {
    const data = {
        formula: results.roll.formula,
        total: results.successes
    };
    // Prepare dice parts
    data["parts"] = results.roll.dice.map(d => {
        let maxRoll = CONFIG.YZECORIOLIS.maxRoll;
        // Generate tooltip data
        return {
            formula: d.formula,
            total: results.successes,
            faces: d.faces,
            rolls: d.results.map(r => {
                return {
                    result: '&nbsp;',
                    showNum: r.result === maxRoll,
                    classes: [
                        d.constructor.name.toLowerCase(),
                        "d" + d.faces,
                        "dice-" + r.result,
                        "dice-face",
                        r.rerolled ? "rerolled" : null,
                        (r.result === maxRoll) ? "success" : null
                    ].filter(c => c).join(" ")
                }
            })
        };
    });
    return data;
}

export async function coriolisChatListeners(html) {
    html.on("click", ".dice-push", ev => {
        let button = $(ev.currentTarget),
            messageId = button.parents('.message').attr("data-message-id"),
            message = game.messages.get(messageId);
        let results = message.data.flags.data.results;
        coriolisPushRoll(message, results.rollData, message.roll);
    })
}
/**
 * Add support for the Dice So Nice module
 * @param {Object} roll
 * @param {String} rollMode
 */
async function showDiceSoNice(roll, rollMode) {
    if (game.modules.get("dice-so-nice") && game.modules.get("dice-so-nice").active) {
        let whisper = null;
        let blind = false;
        switch (rollMode) {
            case "blindroll": //GM only
                blind = true;
            case "gmroll": //GM + rolling player
                let gmList = game.users.filter(user => user.isGM);
                let gmIDList = [];
                gmList.forEach(gm => gmIDList.push(gm.data._id));
                whisper = gmIDList;
                break;
            case "roll": //everybody
                let userList = game.users.filter(user => user.active);
                let userIDList = [];
                userList.forEach(user => userIDList.push(user.data._id));
                whisper = userIDList;
                break;
            case "selfroll": // only roll to yourself
                let selfList = game.users.filter(user => user._id === game.user._id);
                let selfIDList = [];
                selfList.forEach(user => selfIDList.push(user.data._id));
                whisper = selfIDList;
                break;
        }
        await game.dice3d.showForRoll(roll, game.user, true, whisper, blind);
    }
}