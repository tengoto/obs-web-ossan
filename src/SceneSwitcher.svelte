<script>
import { onDestroy, onMount } from 'svelte'
import { obs, sendCommand } from './obs.js'

import SourceButton from './SourceButton.svelte'

export let programScene = {}
export let previewScene = {}
export let scenes = []
export let buttonStyle = 'text' // text, screenshot, icon
export let editable = false

let scenesFiltered = []
let isStudioMode = false
const sceneIcons = JSON.parse(window.localStorage.getItem('sceneIcons') || '{}')

// Hotkey settings
const BLACK_SCENE_NAME = 'BLACK'
let fadeToBlackReturnScene = ''
let fadeToBlackActive = false
let hotkeyBusy = false

$: scenesFiltered = scenes
  .filter((scene) => scene.sceneName.indexOf('(hidden)') === -1)
  .reverse()

// store sceneIcons on change
$: window.localStorage.setItem('sceneIcons', JSON.stringify(sceneIcons))

onMount(async function () {
  let data = await sendCommand('GetSceneList')
  console.log('GetSceneList', data)
  programScene = data.currentProgramSceneName || ''
  previewScene = data.currentPreviewSceneName
  scenes = data.scenes

  data = await sendCommand('GetStudioModeEnabled')
  if (data && data.studioModeEnabled) {
    isStudioMode = true
    previewScene = data.currentPreviewSceneName || ''
  }
})

// Named handlers (not inline arrow functions passed straight to obs.on)
// so onDestroy can remove the exact same references via obs.off().
function handleStudioModeStateChanged (data) {
  console.log('StudioModeStateChanged', data.studioModeEnabled)
  isStudioMode = data.studioModeEnabled
  previewScene = programScene
}

function handleSceneListChanged (data) {
  console.log('SceneListChanged', data.scenes.length)
  scenes = data.scenes
}

function handleSceneCreated (data) {
  console.log('SceneCreated', data)
}

function handleSceneRemoved (data) {
  console.log('SceneRemoved', data)
}

function handleSceneNameChanged (data) {
  console.log('SceneNameChanged', data)
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].sceneName === data.oldSceneName) {
      scenes[i].sceneName = data.sceneName
    }
  }

  // Rename in sceneIcons
  sceneIcons[data.sceneName] = sceneIcons[data.oldSceneName]
}

function handleCurrentProgramSceneChanged (data) {
  console.log('CurrentProgramSceneChanged', data)
  programScene = data.sceneName || ''

  // If Program was changed away from BLACK by some other operation,
  // consider Fade-to-Black no longer active.
  const blackScene = findBlackScene()
  if (
    fadeToBlackActive &&
    blackScene &&
    programScene !== blackScene.sceneName &&
    programScene !== fadeToBlackReturnScene
  ) {
    fadeToBlackActive = false
    fadeToBlackReturnScene = ''
  }
}

function handleCurrentPreviewSceneChanged (data) {
  console.log('CurrentPreviewSceneChanged', data)
  previewScene = data.sceneName
}

obs.on('StudioModeStateChanged', handleStudioModeStateChanged)
obs.on('SceneListChanged', handleSceneListChanged)
obs.on('SceneCreated', handleSceneCreated)
obs.on('SceneRemoved', handleSceneRemoved)
obs.on('SceneNameChanged', handleSceneNameChanged)
obs.on('CurrentProgramSceneChanged', handleCurrentProgramSceneChanged)
obs.on('CurrentPreviewSceneChanged', handleCurrentPreviewSceneChanged)

onDestroy(() => {
  obs.off('StudioModeStateChanged', handleStudioModeStateChanged)
  obs.off('SceneListChanged', handleSceneListChanged)
  obs.off('SceneCreated', handleSceneCreated)
  obs.off('SceneRemoved', handleSceneRemoved)
  obs.off('SceneNameChanged', handleSceneNameChanged)
  obs.off('CurrentProgramSceneChanged', handleCurrentProgramSceneChanged)
  obs.off('CurrentPreviewSceneChanged', handleCurrentPreviewSceneChanged)
})

function sceneClicker (scene) {
  return async function () {
    if (isStudioMode) {
      await sendCommand('SetCurrentPreviewScene', { sceneName: scene.sceneName })
    } else {
      await sendCommand('SetCurrentProgramScene', { sceneName: scene.sceneName })
    }
  }
}

function onNameChange (event) {
  sendCommand('SetSceneName', {
    sceneName: event.target.title,
    newSceneName: event.target.value
  })
}

function onIconChange (event) {
  sceneIcons[event.target.title] = event.target.value
}

/*
 * Keyboard controls
 *
 * 1-9 : Select scene 1-9
 *       Studio Mode ON  -> Preview
 *       Studio Mode OFF -> Program
 *
 * =   : Trigger normal Studio Mode transition
 *
 * 0   : Fade to BLACK
 *       Press 0 again to fade back to the Program scene that was live
 *       immediately before BLACK.
 *
 * Text inputs/selects are ignored so editing scene names does not
 * accidentally switch scenes.
 */
function isTypingTarget (target) {
  if (!target) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

async function switchSceneByNumber (number) {
  const scene = scenesFiltered[number - 1]
  if (!scene) {
    console.warn(`Hotkey ${number}: scene ${number} does not exist`)
    return
  }

  if (isStudioMode) {
    await sendCommand('SetCurrentPreviewScene', { sceneName: scene.sceneName })
  } else {
    await sendCommand('SetCurrentProgramScene', { sceneName: scene.sceneName })
  }
}

async function triggerNormalTransition () {
  if (!isStudioMode) {
    console.warn('Transition hotkey (=) requires Studio Mode')
    return
  }

  await sendCommand('TriggerStudioModeTransition')
}

function findBlackScene () {
  return scenes.find((scene) => {
    // Allows either "BLACK" or "BLACK (hidden)".
    const normalized = scene.sceneName
      .replace(/\(hidden\)/gi, '')
      .trim()
      .toUpperCase()

    return normalized === BLACK_SCENE_NAME
  })
}

async function getFadeTransitionName () {
  const data = await sendCommand('GetSceneTransitionList')
  const transitions = data?.transitions || []

  // Prefer the standard English name, but also accept Japanese OBS naming.
  const exactEnglish = transitions.find(
    (transition) => transition.transitionName === 'Fade'
  )
  if (exactEnglish) return exactEnglish.transitionName

  const exactJapanese = transitions.find(
    (transition) => transition.transitionName === 'フェード'
  )
  if (exactJapanese) return exactJapanese.transitionName

  const fuzzy = transitions.find((transition) => {
    const name = (transition.transitionName || '').toLowerCase()
    return name.includes('fade') || name.includes('フェード')
  })

  return fuzzy?.transitionName || null
}

async function fadeToBlackToggle () {
  if (!isStudioMode) {
    alert('0キーの「黒にフェード」は Studio Mode で使用してください。')
    return
  }

  const blackScene = findBlackScene()
  if (!blackScene) {
    alert(
      '黒画面用のシーンがありません。\n' +
      'OBSに「BLACK」または「BLACK (hidden)」というシーンを作成してください。'
    )
    return
  }

  const previousTransition = await sendCommand('GetCurrentSceneTransition')
  const fadeTransitionName = await getFadeTransitionName()

  if (!fadeTransitionName) {
    alert('OBSに「Fade / フェード」トランジションが見つかりません。')
    return
  }

  let targetScene

  if (!fadeToBlackActive) {
    // Remember exactly what was live before going black.
    fadeToBlackReturnScene = programScene
    targetScene = blackScene.sceneName
  } else {
    targetScene = fadeToBlackReturnScene

    if (!targetScene) {
      console.warn('No scene stored for Fade-to-Black return')
      return
    }
  }

  try {
    // QUICK TRANSITION: use Fade temporarily.
    await sendCommand('SetCurrentPreviewScene', { sceneName: targetScene })
    await sendCommand('SetCurrentSceneTransition', {
      transitionName: fadeTransitionName
    })
    await sendCommand('TriggerStudioModeTransition')

    // Wait until the fade should be complete before restoring the
    // user's normal transition. This keeps "=" behaving as before.
    const transitionDuration = Math.max(
      Number(previousTransition?.transitionDuration) || 300,
      50
    )

    await new Promise((resolve) =>
      setTimeout(resolve, transitionDuration + 100)
    )

    if (
      previousTransition?.transitionName &&
      previousTransition.transitionName !== fadeTransitionName
    ) {
      await sendCommand('SetCurrentSceneTransition', {
        transitionName: previousTransition.transitionName
      })
    }

    fadeToBlackActive = !fadeToBlackActive

    if (!fadeToBlackActive) {
      fadeToBlackReturnScene = ''
    }
  } catch (error) {
    console.error('Fade-to-Black failed:', error)
  }
}

async function handleHotkey (event) {
  if (isTypingTarget(event.target)) return
  if (event.repeat) return

  // Do not steal browser/OS shortcuts.
  if (event.ctrlKey || event.metaKey || event.altKey) return

  const key = event.key

  if (/^[1-9]$/.test(key)) {
    event.preventDefault()

    if (hotkeyBusy) return
    hotkeyBusy = true

    try {
      await switchSceneByNumber(Number(key))
    } finally {
      hotkeyBusy = false
    }

    return
  }

  if (key === '=' || event.code === 'Equal') {
    event.preventDefault()

    if (hotkeyBusy) return
    hotkeyBusy = true

    try {
      await triggerNormalTransition()
    } finally {
      hotkeyBusy = false
    }

    return
  }

  if (key === '0' || event.code === 'Numpad0') {
    event.preventDefault()

    if (hotkeyBusy) return
    hotkeyBusy = true

    try {
      await fadeToBlackToggle()
    } finally {
      hotkeyBusy = false
    }
  }
}
</script>

<svelte:window on:keydown={handleHotkey} />

<ol
  class:column={editable}
  class:with-icon={buttonStyle === 'icon'}
>
  {#if editable}
    {#each [...scenes].reverse() as scene}
      <li>
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label class="label">Name</label>
        <input
          type="text"
          class="input"
          title={scene.sceneName}
          value={scene.sceneName}
          on:change={onNameChange}
        />
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label class="label">Icon</label>
        <input
          type="text"
          class="input"
          title={scene.sceneName}
          value={sceneIcons[scene.sceneName] || ''}
          on:change={onIconChange}
        />
      </li>
    {/each}
  {:else}
    {#each scenesFiltered as scene}
      <li>
        <SourceButton
          name={scene.sceneName}
          on:click={sceneClicker(scene)}
          isProgram={programScene === scene.sceneName}
          isPreview={previewScene === scene.sceneName}
          buttonStyle={buttonStyle}
          icon={sceneIcons[scene.sceneName] || `#${Math.floor(Math.random() * 16777215).toString(16)}`}
        />
      </li>
    {/each}
  {/if}
</ol>

<style>
ol {
  list-style: None;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: .5rem;
  margin-bottom: 2rem;
}

ol.column {
  flex-direction: column;
  gap: 1rem;
}

li {
  display: inline-block;
  min-width: 10rem;
  flex-grow: 1;
}

ol.with-icon {
  justify-content: center;
}

ol.with-icon li {
  min-width: 0;
  flex-grow: 0;
  flex-shrink: 1;
}
</style>
