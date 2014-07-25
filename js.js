$(function() {
    var INSTITUTION_TREE_ID = "institution-tree";
    var INSTITUTION_CHECKBOX_ID_PREFIX = "checkbox-";

    // Institution names matching any of these patterns will be excluded by
    // default.
    var DEFAULT_EXCLUSION_LIST_INCLUSION_PATTERNS = [
        / - /,
        /\b(entry|course|\d+)$/i,
        /^(insts|Colleges)$/,
        /\b(Institutions|Courses?|Temporary)\b/
    ];

    var $exclusionList = $("#step-2-form textarea[name='exclusion-list']");
    var $institutionTreeGroup = $("#institution-tree-group");
    var $step2 = $("#step-2");

    var excludedInstitutions = null;
    var syncing = false;

    var substitutions = [];
    var substitutionsOccurences = [];
    var $substitutionsInput = $('#substitutions-input');

    var substitutionTemplate = _.template($('#substitution-template').text());
    var substitutionRegExp = new RegExp("^s/((?:(?:\\\\/)|[^/])*)/((?:(?:\\\\/)|[^/])*)/$");

    var futureStylesheet = getStylesheet();

    function getStylesheet() {
        if(window.location.protocol === "file:") {
            console.info("Loading xslt stylesheet from DOM element");
            return getStylesheetFromDOM();
        }
        console.info("Loading xslt stylesheet via AJAX");
        return getStylesheetViaAJAX();
    }

    function getStylesheetViaAJAX() {
        var result = new $.Deferred();

        $.when($.ajax("stylesheet.xml"))
            .done(function(stylesheet) {
                var processor = new XSLTProcessor();
                processor.importStylesheet(stylesheet);

                result.resolve(processor);
            })
            .fail(function(jqXHR, textStatus, errorThrown) {
                result.reject(jqXHR, textStatus, errorThrown);
            });

        return result.promise();
    }

    function getStylesheetFromDOM() {
        var result = new $.Deferred();

        try {
            var stylesheet = $.parseXML($("#xslt-stylesheet").text().trim());
            var processor = new XSLTProcessor();
            processor.importStylesheet(stylesheet);
            result.resolve(processor);
        }
        catch(e) {
            result.reject(e, e.message);
        }
        return result;
    }

    function renderInstitutionTree(institutionXml, stylesheet) {
        var doc = stylesheet.transformToDocument(institutionXml);
        return $(document.importNode(doc.firstChild, true))
                .wrap("<div>")
                .parent()
                .html();
    }

    function onInstitutionXmlChanged(xml) {
        if(!xml) {
            return;
        }

        $.when(futureStylesheet).done(function(stylesheet) {
            $institutionTreeGroup
                .empty()
                .append(renderInstitutionTree(xml, stylesheet));

            initInstitutionTree();
        });
    }

    function initInstitutionTree() {
        var exclusions = $exclusionList.val().trim();
        excludedInstitutions = (exclusions === "" ?
            buildDefaultExclusionList() : parseExclusionList());

        syncing = true;
        refreshTreeSelections(excludedInstitutions);
        $exclusionList.val(buildExclusionList(excludedInstitutions));
        generateCsv();
        syncing = false;

        $step2.removeClass("hidden");

        var tree = $("#institution-tree-group");

        $("#exclusion-list-fixed-wrapper").affix({
            offset: {
                top: $("#exclusion-list-fixed-wrapper").position().top - 20,
            }
        });

        // Warn on navigation
        window.onbeforeunload = beforeUnload;
    }

    function buildExclusionList(excludedInstitutions) {
        return _.chain(excludedInstitutions)
            .map(function(name, id){
                return id + " - " + name;
            })
            .sort()
            .value()
            .join("\n");
    }

    function parseExclusionList(exclusionList) {
        return _.chain(exclusionList.split("\n"))
            .map(function(line) {
                var match = /(\w+)( - (.*))?/.exec(line.trim());
                return match && [match[1], match[3]];
            })
            .filter(Boolean)
            .object()
            .value();
    }

    function refreshTreeSelections(excludedInstitutions) {
        var $checkboxes = $("#" + INSTITUTION_TREE_ID + " input[type=checkbox]");
        // check everything
        $checkboxes.prop("checked", true);

        // check the non-excluded items
        var excludedCheckboxIds = _.map(excludedInstitutions, function(val, id){
            return "#" + INSTITUTION_CHECKBOX_ID_PREFIX + id;
        }).join(",");
        $(excludedCheckboxIds).prop("checked", false);
    }

    function onSubstitutionsSubmit() {
        substitutions = _.chain($substitutionsInput.val().split(/\n/g))
            .map(parseSubstitution)
            .compact()
            .value();
        $substitutionsInput.focus();
        generateCsv();
    }

    function applySubstitutionsTo(text) {
        _.each(substitutions, function(substitution, index) {
            // substitution[0] = the regex to match
            // substitution[1] = the string to replace matches with
            var regExp = new RegExp(substitution[0], "g");
            var occurences = text.match(regExp);
            // Keep track of how many times a match was found using this regex
            updateSubstitutionOccurences(index, occurences ? occurences.length : 0);
            text = text.replace(regExp, substitution[1]);
        });
        return text;
    }

    function updateSubstitutionOccurences(index, addCount) {
        substitutionsOccurences[index] = (substitutionsOccurences[index] || 0) + addCount;
    }

    function resetSubstitutionsOccurences() {
        substitutionsOccurences = [];
    }

    function parseSubstitution(substitutionString) {
        var matches = _.map(substitutionString.match(substitutionRegExp), function(match) {
            return match.replace(/\\\//g, "/");
        });
        return matches && matches[1] ? [matches[1], matches[2]] : null;
    }

    function renderSubstitutions() {
        var html = _.map(substitutions, renderSubstitution).join('');
        $("#substitutions-list").html(html);
    }

    function renderSubstitution(substitution, index) {
        return substitutionTemplate({
            find: substitution[0],
            replace: substitution[1],
            occurences: substitutionsOccurences[index]
        });
    }

    function generateCsv() {
        resetSubstitutionsOccurences();
        var $checkboxes = $("#" + INSTITUTION_TREE_ID + " input[type=checkbox]:checked");
        var institutions = _.map($checkboxes, function(checkbox) {
            var $cb = $(checkbox);
            var id = $cb.data("instid");
            var label = applySubstitutionsTo($cb.parent("label").text())
            return [id, label];
        });
        $("#institution-list-csv").val(CSV.arrayToCsv(institutions));
        renderSubstitutions();
    }

    function download(data, mime) {
        // Remove any navigation warning which doesn't matter as we're
        // only downloading, not actually navigating away.
        var onbeforeunload = window.onbeforeunload;
        window.onbeforeunload = null;

        // Navigate to a data URI. This should "download" the contents of the URI.
        mime = mime || "application/octet-stream";
        var uri = "data:" + mime + "," + encodeURIComponent(data);
        window.location = uri;

        _.defer(function() {
            // restore previous value
            window.onbeforeunload = onbeforeunload;
        });
    }

    function beforeUnload(e) {
        // If we haven't been passed the event get the window.event
        e = e || window.event;

        var message = "Your changes to the institution list will be lost if " +
            "you proceed.";

        // For IE6-8 and Firefox prior to version 4
        if (e) {
            e.returnValue = message;
        }

        // For Chrome, Safari, IE8+ and Opera 12+
        return message;
    }

    function seemsLikeUnimportantInstitution(name) {
        return _.any(DEFAULT_EXCLUSION_LIST_INCLUSION_PATTERNS, function(p) {
            return p.test(name);
        });
    }

    function buildDefaultExclusionList() {
        var $checkboxes = $("#" + INSTITUTION_TREE_ID + " input[type=checkbox]");

        return _.chain($checkboxes)
            .map(function(checkbox) {
                var $cb = $(checkbox);
                return [$cb.data("instid"), $cb.parent("label").text()];
            })
            .filter(function(inst) {
                return seemsLikeUnimportantInstitution(inst[1]);
            })
            .object()
            .value();
    }

    $("#step-1-form").on("submit", function(e) {
        // Prevent the submit from being handled by the browser
        e.preventDefault();

        var xml;
        var userXmlString = $("#step-1-form-xml").val().trim();
        if(userXmlString === "") {
            $("#step-1-form-xml-group").addClass("has-error");
            $("#step-1-form-xml-group .error-msg")
                .text("Enter the XML from the above link").show();
            onInstitutionXmlChanged(null);
            return;
        }
        try {
            xml = $.parseXML(userXmlString);
        }
        catch(err) {
            $("#step-1-form-xml-group").addClass("has-error");
            $("#step-1-form-xml-group .error-msg").text("Invalid XML").show();
            onInstitutionXmlChanged(null);
            return;
        }
        $("#step-1-form-xml-group").removeClass("has-error");
        $("#step-1-form-xml-group .error-msg").hide();

        onInstitutionXmlChanged(xml);
    });

    // Handle changes to the checkboxes in the institution tree. The exclusion
    // list textarea is updated to reflect the new tree state.
    $("#step-2-form").on("change", "input[type=checkbox]", function(e) {
        if(syncing) {
            return;
        }

        var id = $(this).data("instid");
        if($(this).is(":checked")) {
            delete excludedInstitutions[id];
        }
        else {
            excludedInstitutions[id] = $(this).parent("label").text();
        }
        syncing = true;
        $exclusionList.val(buildExclusionList(excludedInstitutions));
        generateCsv();
        syncing = false;
    });

    // Handle changes to the exclusion list textarea. The tree's selections
    // are updated to reflect the list.
    $exclusionList.on("change", function() {
        if(syncing) {
            return;
        }

        excludedInstitutions = parseExclusionList($(this).val());

        syncing = true;
        refreshTreeSelections(excludedInstitutions);
        generateCsv();
        syncing = false;
    });

    $('#btn-substitutions-download').on("click", function() {
        var text = $substitutionsInput.val();
        download(text, "application/octet-stream");
    });
    $substitutionsInput.on('change', onSubstitutionsSubmit);

    $("#exclusion-list-dl-btn").on("click", function() {
        var text = $("#exclusion-list").val();
        download(text, "application/octet-stream");
    });

    $("#csv-dl-btn").on("click", function() {
        var csv = $("#institution-list-csv").val();
        download(csv, "text/csv");
    });

    $.when(futureStylesheet).fail(function() {
         $("#modal-stylesheet-error").modal({
             keyboard: false,
             backdrop: "static"
         });
     });
});
