;; Analytics Tracker
;; Event-first analytics logging contract for Stacks dApps.

(define-constant CONTRACT_NAME "analytics-tracker")
(define-constant VERSION "1.0.0")

(define-public (track-page-view
    (project-id (string-ascii 40))
    (page (string-utf8 120))
  )
  (begin
    (print {
      event: "page-view",
      project: project-id,
      page: page,
      sender: tx-sender,
      burn-block: burn-block-height,
    })
    (ok true)
  )
)

(define-public (track-action
    (project-id (string-ascii 40))
    (action (string-ascii 40))
    (target (string-utf8 120))
  )
  (begin
    (print {
      event: "action",
      project: project-id,
      action: action,
      target: target,
      sender: tx-sender,
      burn-block: burn-block-height,
    })
    (ok true)
  )
)

(define-public (track-conversion
    (project-id (string-ascii 40))
    (conversion-type (string-ascii 40))
    (value uint)
  )
  (begin
    (print {
      event: "conversion",
      project: project-id,
      conversion: conversion-type,
      value: value,
      sender: tx-sender,
      burn-block: burn-block-height,
    })
    (ok true)
  )
)

(define-public (track-custom-event
    (project-id (string-ascii 40))
    (event-type (string-ascii 40))
    (payload (string-utf8 300))
  )
  (begin
    (print {
      event: "custom",
      project: project-id,
      event-type: event-type,
      payload: payload,
      sender: tx-sender,
      burn-block: burn-block-height,
    })
    (ok true)
  )
)

(define-read-only (get-contract-info)
  (ok {
    contract: CONTRACT_NAME,
    version: VERSION,
    stateless: true,
  })
)
