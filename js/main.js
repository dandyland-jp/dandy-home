(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * モバイルナビゲーション（ハンバーガーメニュー）
   * ------------------------------------------------------------------ */
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("main-nav");
  var overlay = document.getElementById("nav-overlay");

  function closeNav() {
    if (!nav || !toggle || !overlay) return;
    nav.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "メニューを開く");
    document.body.style.overflow = "";
  }

  function openNav() {
    if (!nav || !toggle || !overlay) return;
    nav.classList.add("is-open");
    overlay.hidden = false;
    // 次のフレームでtransitionを発火させる
    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "メニューを閉じる");
    document.body.style.overflow = "hidden";
  }

  if (toggle && nav && overlay) {
    toggle.addEventListener("click", function () {
      var isOpen = toggle.getAttribute("aria-expanded") === "true";
      if (isOpen) {
        closeNav();
      } else {
        openNav();
      }
    });

    overlay.addEventListener("click", closeNav);

    nav.querySelectorAll(".nav-link, .btn--nav").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });

    // デスクトップ幅にリサイズされたら状態をリセット
    var mq = window.matchMedia("(min-width: 1200px)");
    mq.addEventListener("change", function (e) {
      if (e.matches) closeNav();
    });
  }

  /* ------------------------------------------------------------------
   * ヘッダーの高さ分だけアンカーリンクのスクロール位置を補正
   * ------------------------------------------------------------------ */
  var header = document.getElementById("site-header");
  if (header && "CSS" in window && CSS.supports && CSS.supports("scroll-margin-top", "1px")) {
    var headerHeight = header.offsetHeight;
    document.querySelectorAll("main [id]").forEach(function (el) {
      el.style.scrollMarginTop = headerHeight + 16 + "px";
    });
  }

  /* ------------------------------------------------------------------
   * 固定CTA（1024〜1199px）：ファーストビューを過ぎてから表示する
   * この幅ではヘッダーの相談ボタンが出ないため固定CTAで導線を確保するが、
   * ファーストビュー表示中はスクロール矢印・ボタンと重ならないよう隠す（表示の切り替えは CSS）。
   * ------------------------------------------------------------------ */
  var firstView = document.querySelector(".hero, .sp-hero");
  if (firstView && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-cta-watch");
    new IntersectionObserver(function (entries) {
      document.body.classList.toggle("is-past-hero", !entries[0].isIntersecting);
    }).observe(firstView);
  }

  /* ------------------------------------------------------------------
   * お問い合わせフォーム（Formspree 接続 / Ajax 送信）
   * エンドポイント: https://formspree.io/f/xaenobnw
   * ・必須：お名前／メールアドレスか電話番号のどちらか一方／プライバシーポリシーへの同意
   *   （HTML側の required は「お名前」「同意」のみ。連絡先はここで判定する）
   * ・入力エラー時は最初のエラー項目へ移動し、aria-invalid で読み上げにも伝える
   * ・メールアドレスが空欄のときは email 項目を送らない（Formspree の形式チェック対策）
   * ・入力中はスマホ固定CTAを隠し、入力欄やキーボードと重ならないようにする
   * ------------------------------------------------------------------ */
  var form = document.getElementById("contact-form");
  var note = document.getElementById("contact-form-note");

  if (form) {
    var submitBtn = form.querySelector(".contact-form__submit");
    var submitBtnDefaultText = submitBtn ? submitBtn.textContent : "";
    var isSubmitting = false;
    var fieldIds = ["cf-name", "cf-email", "cf-tel", "cf-privacy"];
    var failMessage =
      "通信状況をご確認のうえ、時間をおいて再度お試しください。お急ぎの場合は、LINEまたはお電話（042-816-3369）でもご相談いただけます。";

    function setFieldError(id, message) {
      var errorEl = document.getElementById(id + "-error");
      var input = document.getElementById(id);
      if (errorEl) errorEl.textContent = message || "";
      if (input) {
        if (message) {
          input.setAttribute("aria-invalid", "true");
        } else {
          input.removeAttribute("aria-invalid");
        }
      }
    }

    function clearErrors() {
      fieldIds.forEach(function (id) {
        setFieldError(id, "");
      });
    }

    function hideNote() {
      if (!note) return;
      note.hidden = true;
      note.textContent = "";
      note.removeAttribute("role");
      note.classList.remove("contact-form__note--success", "contact-form__note--error");
    }

    // 送信結果は目立つ枠で表示し、フォーカスを移して読み上げ・スクロールさせる
    function showNote(title, message, isSuccess) {
      if (!note) return;
      note.textContent = "";
      var titleEl = document.createElement("p");
      titleEl.className = "contact-form__note-title";
      titleEl.textContent = title;
      var textEl = document.createElement("p");
      textEl.className = "contact-form__note-text";
      textEl.textContent = message;
      note.appendChild(titleEl);
      note.appendChild(textEl);
      note.setAttribute("role", isSuccess ? "status" : "alert");
      note.classList.remove("contact-form__note--success", "contact-form__note--error");
      note.classList.add(isSuccess ? "contact-form__note--success" : "contact-form__note--error");
      note.hidden = false;
      note.focus({ preventScroll: true });
      note.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    // 全角数字・記号を半角にそろえてから、数字の桁数で電話番号らしさを判定する
    function normalizeTel(value) {
      return value
        .replace(/[０-９]/g, function (c) {
          return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
        })
        .replace(/[ー－‐−―]/g, "-")
        .trim();
    }

    function isValidTel(value) {
      if (!/^[0-9+\-()（）\s]+$/.test(value)) return false;
      var digits = value.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 13;
    }

    function validateForm() {
      var firstInvalid = null;
      var nameInput = document.getElementById("cf-name");
      var emailInput = document.getElementById("cf-email");
      var telInput = document.getElementById("cf-tel");
      var privacyInput = document.getElementById("cf-privacy");

      function fail(input, id, message) {
        setFieldError(id, message);
        if (!firstInvalid) firstInvalid = input;
      }

      if (nameInput && !nameInput.value.trim()) {
        fail(nameInput, "cf-name", "お名前を入力してください。");
      }

      var emailValue = emailInput ? emailInput.value.trim() : "";
      var telValue = telInput ? normalizeTel(telInput.value) : "";
      if (telInput) telInput.value = telValue;

      if (!emailValue && !telValue) {
        var both = "メールアドレスか電話番号の、どちらか一方を入力してください。";
        // メッセージはメール欄の下に1回だけ出し、電話欄は枠の強調のみ
        fail(emailInput, "cf-email", both);
        if (telInput) telInput.setAttribute("aria-invalid", "true");
      } else {
        if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
          fail(emailInput, "cf-email", "メールアドレスの形式が正しくありません。（例：name@example.com）");
        }
        if (telValue && !isValidTel(telValue)) {
          fail(telInput, "cf-tel", "電話番号の形式をご確認ください。（例：042-816-3369）");
        }
      }

      if (privacyInput && !privacyInput.checked) {
        fail(privacyInput, "cf-privacy", "プライバシーポリシーへの同意が必要です。");
      }

      if (firstInvalid) {
        firstInvalid.focus({ preventScroll: true });
        firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
        return false;
      }
      return true;
    }

    // 入力し直したら、その項目のエラー表示を消す（連絡先はメール・電話の両方）
    form.addEventListener("input", function (e) {
      var id = e.target && e.target.id;
      if (id === "cf-email" || id === "cf-tel") {
        setFieldError("cf-email", "");
        setFieldError("cf-tel", "");
      } else if (fieldIds.indexOf(id) !== -1) {
        setFieldError(id, "");
      }
    });
    form.addEventListener("change", function (e) {
      if (e.target && e.target.id === "cf-privacy" && e.target.checked) setFieldError("cf-privacy", "");
    });

    // 入力中はスマホ固定CTAを隠す
    form.addEventListener("focusin", function () {
      document.body.classList.add("is-form-focused");
    });
    form.addEventListener("focusout", function () {
      setTimeout(function () {
        if (!form.contains(document.activeElement)) document.body.classList.remove("is-form-focused");
      }, 0);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (isSubmitting) return;

      hideNote();
      clearErrors();

      if (!validateForm()) return;

      var data = new FormData(form);
      if (!String(data.get("email") || "").trim()) data.delete("email");

      isSubmitting = true;
      form.setAttribute("aria-busy", "true");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "送信中...";
      }

      fetch(form.action, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      })
        .then(function (response) {
          if (response.ok) {
            showNote(
              "ご相談ありがとうございます。",
              "内容を確認のうえ、担当者よりご連絡いたします。",
              true
            );
            form.reset();
            return;
          }
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              var errors = (body && body.errors) || [];
              var emailError = errors.some(function (err) {
                return err && err.field === "email";
              });
              if (emailError) {
                setFieldError("cf-email", "メールアドレスの形式が正しくありません。（例：name@example.com）");
              }
              showNote("送信できませんでした。", failMessage, false);
            });
        })
        .catch(function () {
          showNote("送信できませんでした。", failMessage, false);
        })
        .finally(function () {
          isSubmitting = false;
          form.removeAttribute("aria-busy");
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtnDefaultText;
          }
        });
    });
  }

  /* ------------------------------------------------------------------
   * WORKS（施工事例ギャラリーの横スライド・無限ループ）
   * 横スクロール自体はCSS（scroll-snap）で動く。ここでは
   *  1) HTML上のカード一式を前後に1セットずつ複製し（表示専用・読み上げ対象外）、
   *     「複製 / 本物 / 複製」の3セットを並べる
   *  2) スクロールが止まった時点で前後の複製セット側にいたら、
   *     見た目が同じ本物セットの位置へ瞬時に移す（1セット分だけずらすので画面は変わらない）
   *  3) 左右ボタンはカード1枚分ずつ送る（端でも無効化しない）
   * カード枚数はDOMから取得するため、.works-card を増やしてもこの処理の変更は不要。
   * ------------------------------------------------------------------ */
  var worksTrack = document.getElementById("works-track");
  if (worksTrack) {
    var worksSection = worksTrack.closest(".works");
    var worksPrev = worksSection.querySelector(".works__nav--prev");
    var worksNext = worksSection.querySelector(".works__nav--next");
    var worksOriginals = Array.prototype.slice.call(worksTrack.querySelectorAll(".works-card"));
    var worksCount = worksOriginals.length;
    var worksLoop = worksCount >= 2;

    function makeWorksClone(card) {
      var clone = card.cloneNode(true);
      // 複製は読み上げ・キーボード操作の対象外にする（タップで詳細を開くことはできる）
      clone.setAttribute("aria-hidden", "true");
      clone.classList.add("works-card--clone");
      Array.prototype.forEach.call(clone.querySelectorAll("button, a"), function (el) {
        el.setAttribute("tabindex", "-1");
      });
      clone.removeAttribute("data-case");
      Array.prototype.forEach.call(clone.querySelectorAll("img"), function (img) {
        img.setAttribute("alt", "");
      });
      return clone;
    }

    if (worksLoop) {
      var worksBefore = document.createDocumentFragment();
      var worksAfter = document.createDocumentFragment();
      worksOriginals.forEach(function (card) {
        worksBefore.appendChild(makeWorksClone(card));
        worksAfter.appendChild(makeWorksClone(card));
      });
      worksTrack.insertBefore(worksBefore, worksOriginals[0]);
      worksTrack.appendChild(worksAfter);
    }

    // カード左端のスクロール位置（scroll-padding 分を差し引いた、スナップ位置と同じ基準）
    function worksPos(card) {
      var padding = parseFloat(getComputedStyle(worksTrack).scrollPaddingLeft) || 0;
      return (
        card.getBoundingClientRect().left -
        worksTrack.getBoundingClientRect().left +
        worksTrack.scrollLeft -
        padding
      );
    }

    function worksStep() {
      var cards = worksTrack.querySelectorAll(".works-card");
      if (cards.length < 2) return worksTrack.clientWidth;
      return worksPos(cards[1]) - worksPos(cards[0]);
    }

    function worksSetWidth() {
      return worksStep() * worksCount;
    }

    // 前後の複製セットにいる場合、1セット分ずらして本物セットへ戻す（瞬時・見た目は同じ）
    function normalizeWorks() {
      if (!worksLoop) return;
      var start = worksPos(worksOriginals[0]);
      var setWidth = worksSetWidth();
      var x = worksTrack.scrollLeft;
      if (x < start - worksStep() / 2) {
        worksTrack.scrollLeft = x + setWidth;
      } else if (x >= start + setWidth - worksStep() / 2) {
        worksTrack.scrollLeft = x - setWidth;
      }
    }

    function moveWorks(direction) {
      normalizeWorks();
      worksTrack.scrollBy({ left: direction * worksStep(), behavior: "smooth" });
    }

    if (worksPrev) {
      worksPrev.addEventListener("click", function () {
        moveWorks(-1);
      });
    }
    if (worksNext) {
      worksNext.addEventListener("click", function () {
        moveWorks(1);
      });
    }

    // スクロールが止まったら位置を整える（scrollend 未対応ブラウザは一定時間の停止で判定）
    var worksIdleTimer = null;
    worksTrack.addEventListener(
      "scroll",
      function () {
        clearTimeout(worksIdleTimer);
        worksIdleTimer = setTimeout(normalizeWorks, 160);
      },
      { passive: true }
    );
    if ("onscrollend" in window) {
      worksTrack.addEventListener("scrollend", function () {
        clearTimeout(worksIdleTimer);
        normalizeWorks();
      });
    }

    // 初期表示・画面幅変更時は、本物セットの1枚目を左端に合わせる
    function resetWorks() {
      if (!worksLoop) return;
      worksTrack.scrollLeft = worksPos(worksOriginals[0]);
    }
    resetWorks();
    var worksResizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(worksResizeTimer);
      worksResizeTimer = setTimeout(normalizeWorks, 160);
    });

    // 施工内容の詳細：data-detail を持つカード（複製を含む）をタップすると、
    // 同じIDの dialog を開く。閉じたら元のカードのボタンへフォーカスを戻す。
    var worksReturnFocus = null;

    function openWorksDetail(id, card) {
      var dialog = document.getElementById(id);
      if (!dialog) return;
      var original = worksTrack.querySelector('.works-card[data-detail="' + id + '"]:not(.works-card--clone)');
      worksReturnFocus = original ? original.querySelector(".works-card__more") : null;
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      document.body.style.overflow = "hidden";
    }

    worksTrack.addEventListener("click", function (e) {
      var card = e.target.closest(".works-card[data-detail]");
      if (!card) return;
      openWorksDetail(card.getAttribute("data-detail"), card);
    });

    Array.prototype.forEach.call(worksSection.querySelectorAll(".works-dialog"), function (dialog) {
      var closeBtn = dialog.querySelector(".works-dialog__close");
      function closeDialog() {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
          dialog.dispatchEvent(new Event("close"));
        }
      }
      if (closeBtn) closeBtn.addEventListener("click", closeDialog);
      // 写真や文章の外側（暗い背景部分）をタップしても閉じる
      dialog.addEventListener("click", function (e) {
        if (e.target === dialog) closeDialog();
      });
      dialog.addEventListener("close", function () {
        document.body.style.overflow = "";
        if (worksReturnFocus) worksReturnFocus.focus({ preventScroll: true });
      });
    });
  }
})();
