/** Messages sent from the dashboard/popup to the service worker. */
export type Message = {type: 'sync'} | {type: 'deleteAll'}
export type Reply = {ok: true} | {ok: false; error: string}

export async function sendMessage(msg: Message): Promise<Reply> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as Reply
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)}
  }
}
