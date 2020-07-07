/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    // expression 只在开发环境中作为错误或警告提示使用即控制台的vue报错信息
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    // 这里的getter会有两种情况：
    //  一、一个函数，比如在生命周期mount的时候，需要watch模板中的值，这个时候传过来的是一个函数，后面在get函数里调用时这个函数时，这个函数会调用数据的getter函数。
    //  二、一个表达式，比如我们在Vue实例的watch中写的表达式，后面在get函数里获取表达式的值的时候会调用数据的getter函数。
    //  expOrFn参数是一个字符串，比如testObj.testObjFirstVal，此时testObj仅仅是一个字符串，而不是对象，我们无法直接获取testObjFirstVal属性的值。
    //  所以我们在获取值得时候不能直接拿到值，parsePath函数就是用来解决这个问题的，这个函数具体的操作，在后面的代码里。
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 注意这个地方，在非computed调用Watch函数外，都会调用get函数（computed有自己的逻辑）
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  // get函数，用来收集依赖和获取数据的值
  get () {
    // 将当前watcher放到全局唯一的Dep.target上
    pushTarget(this)
    let value
    const vm = this.vm
    // 调用this.getter获取值，获取值的过程中可能会有多个被observer的属性被调用 属性修饰符 上面的getter;
    // 因为this.getter调用的时候得到值的过程中会去获取一些对象或数组的值这时这些值会触发他们自己的getter;
    // 在这些 getter 里面都会调用他们自己所在闭包中的dep上的depend方法
    // 去让当前Dep.target上的watcher调用addDep去将这些dep收集到watcher的newDeps数组中，同时
    // watcher.addDep方法里面会调用传入的dep上的addSub方法将自己添加到dep中的subs数组中整个流程如下：
    // new Watcher() -> 调用watcher.getter获取值 -> 将Dep.target设置为当前watcher -> 触发当前watcher所依赖的对象属性或数组中的getter
    // -> 对象属性或数组中的getter触发闭包上dep的depend -> depend调用Dep.target即当前watcher上addDep方法同时传入this即当前dep 
    // -> 当前watcher的addDep方法会将传入的dep添加到watcher的newDeps数组中 -> 调用传入dep上的addSub方法将当前watcher添加到传入dep的subs数组中
    // -> watcher调用cleanupDeps将newDeps数组赋值给deps数组，完成最终的依赖收集
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value)
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      //这里做了一个去重，如果depIds里包含这个id，说明在之前给depIds添加这个id的时候，已经调用过 dep.addSub(this)，即添加过订阅，不需要重复添加。
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      //如果Watcher不依赖于某个数据，即某个Dep,那么不需要再订阅这个数据的消息。
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
     // 更新depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
     // 清空newDepIds
    this.newDepIds.clear()
    tmp = this.deps
    // 更新deps
    this.deps = this.newDeps
    this.newDeps = tmp
    // 清空newDeps
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  // 更新模板或表达式：调用run方法
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      // queueWatcher这个函数最终会调用run方法。
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  // 注意这里调用了get方法，会更新模板，且重新收集依赖
  run () {
    if (this.active) {
      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        //注意下面 this.cb.call，调用回调函数来更新模板或表达式的值（$watch表达式的时候，会更新表达式的值）
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
